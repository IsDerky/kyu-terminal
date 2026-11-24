//! Claude Code como proceso hijo en modo stream-json.
//!
//! Se lanza `claude -p --input-format stream-json --output-format stream-json --verbose
//! --permission-prompt-tool stdio`: cada línea de stdout es un JSON y las peticiones de permiso
//! llegan como `control_request` / `can_use_tool`, que se contestan por stdin.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};

use serde_json::{Value, json};

#[derive(Debug, Clone)]
pub enum Evento {
    Iniciado {
        modelo: String,
    },
    /// Trozo de texto mientras Claude escribe.
    Parcial(String),
    /// Bloque de texto terminado.
    Texto(String),
    Herramienta {
        id: String,
        nombre: String,
        resumen: String,
    },
    ResultadoHerramienta {
        id: String,
        error: bool,
    },
    Permiso(Permiso),
    Contexto(u64),
    Fin {
        coste: f64,
        error: bool,
    },
    Error(String),
    Cerrado,
}

#[derive(Debug, Clone)]
pub struct Permiso {
    pub request_id: String,
    pub herramienta: String,
    pub resumen: String,
    pub input: Value,
    pub sugerencias: Value,
}

pub enum Respuesta {
    Permitir,
    Siempre,
    Denegar,
}

pub struct Claude {
    hijo: Child,
    entrada: Arc<Mutex<ChildStdin>>,
    pub eventos: mpsc::Receiver<Evento>,
}

impl Claude {
    pub fn arrancar(programa: &Path, carpeta: &Path, ctx: egui::Context) -> std::io::Result<Self> {
        let mut cmd = Command::new(programa);
        cmd.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
        ])
        .current_dir(carpeta)
        .env("KYU_TERMINAL", env!("CARGO_PKG_VERSION"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut hijo = cmd.spawn()?;
        let entrada = Arc::new(Mutex::new(hijo.stdin.take().expect("stdin")));
        let salida = hijo.stdout.take().expect("stdout");
        let errores = hijo.stderr.take().expect("stderr");
        let (tx, eventos) = mpsc::channel();

        let tx_err = tx.clone();
        let ctx_err = ctx.clone();
        std::thread::spawn(move || {
            for linea in BufReader::new(errores).lines().map_while(Result::ok) {
                if !linea.trim().is_empty() {
                    let _ = tx_err.send(Evento::Error(linea));
                    ctx_err.request_repaint();
                }
            }
        });

        std::thread::spawn(move || {
            for linea in BufReader::new(salida).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&linea) else {
                    continue;
                };
                for ev in traducir(&v) {
                    let _ = tx.send(ev);
                }
                ctx.request_repaint();
            }
            let _ = tx.send(Evento::Cerrado);
            ctx.request_repaint();
        });

        Ok(Self {
            hijo,
            entrada,
            eventos,
        })
    }

    pub fn enviar(&self, texto: &str) {
        self.escribir(json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": texto }] }
        }));
    }

    pub fn responder(&self, permiso: &Permiso, respuesta: Respuesta) {
        let cuerpo = match respuesta {
            Respuesta::Permitir => json!({ "behavior": "allow", "updatedInput": permiso.input }),
            Respuesta::Siempre => json!({
                "behavior": "allow",
                "updatedInput": permiso.input,
                "updatedPermissions": permiso.sugerencias,
            }),
            Respuesta::Denegar => json!({ "behavior": "deny", "message": "Denegado desde Kyu" }),
        };
        self.escribir(json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": permiso.request_id, "response": cuerpo }
        }));
    }

    fn escribir(&self, v: Value) {
        if let Ok(mut e) = self.entrada.lock() {
            let _ = writeln!(e, "{v}");
            let _ = e.flush();
        }
    }
}

impl Drop for Claude {
    fn drop(&mut self) {
        let _ = self.hijo.kill();
    }
}

/// Un mensaje de stream-json → los eventos que interesan al panel.
fn traducir(v: &Value) -> Vec<Evento> {
    let tipo = v["type"].as_str().unwrap_or("");
    let mut sal = Vec::new();
    match tipo {
        "system" if v["subtype"] == "init" => {
            sal.push(Evento::Iniciado {
                modelo: v["model"].as_str().unwrap_or("?").into(),
            });
        }
        "stream_event" => {
            let ev = &v["event"];
            if ev["type"] == "content_block_delta"
                && ev["delta"]["type"] == "text_delta"
                && let Some(t) = ev["delta"]["text"].as_str()
            {
                sal.push(Evento::Parcial(t.into()));
            }
        }
        "assistant" => {
            let uso = &v["message"]["usage"];
            let contexto = [
                "input_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            ]
            .iter()
            .filter_map(|k| uso[*k].as_u64())
            .sum::<u64>();
            if contexto > 0 {
                sal.push(Evento::Contexto(contexto));
            }
            for bloque in v["message"]["content"].as_array().into_iter().flatten() {
                match bloque["type"].as_str() {
                    Some("text") => {
                        sal.push(Evento::Texto(bloque["text"].as_str().unwrap_or("").into()))
                    }
                    Some("tool_use") => sal.push(Evento::Herramienta {
                        id: bloque["id"].as_str().unwrap_or("").into(),
                        nombre: bloque["name"].as_str().unwrap_or("?").into(),
                        resumen: resumen(bloque["name"].as_str().unwrap_or(""), &bloque["input"]),
                    }),
                    _ => {}
                }
            }
        }
        "user" => {
            for bloque in v["message"]["content"].as_array().into_iter().flatten() {
                if bloque["type"] == "tool_result" {
                    sal.push(Evento::ResultadoHerramienta {
                        id: bloque["tool_use_id"].as_str().unwrap_or("").into(),
                        error: bloque["is_error"].as_bool().unwrap_or(false),
                    });
                }
            }
        }
        "control_request" if v["request"]["subtype"] == "can_use_tool" => {
            let r = &v["request"];
            let herramienta = r["tool_name"].as_str().unwrap_or("?").to_string();
            sal.push(Evento::Permiso(Permiso {
                request_id: v["request_id"].as_str().unwrap_or("").into(),
                resumen: resumen(&herramienta, &r["input"]),
                herramienta,
                input: r["input"].clone(),
                sugerencias: r["permission_suggestions"].clone(),
            }));
        }
        "result" => sal.push(Evento::Fin {
            coste: v["total_cost_usd"].as_f64().unwrap_or(0.0),
            error: v["is_error"].as_bool().unwrap_or(false),
        }),
        _ => {}
    }
    sal
}

/// Lo más útil de la entrada de cada herramienta, en una línea.
fn resumen(herramienta: &str, input: &Value) -> String {
    let campo = match herramienta {
        "Bash" | "PowerShell" => "command",
        "Read" | "Write" | "Edit" | "NotebookEdit" => "file_path",
        "Grep" | "Glob" => "pattern",
        "WebFetch" => "url",
        "WebSearch" => "query",
        "Agent" | "Task" => "description",
        _ => "",
    };
    input[campo]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| {
            let s = input.to_string();
            if s.len() > 80 {
                format!("{}…", &s[..s.floor_char_boundary(80)])
            } else {
                s
            }
        })
}

/// Busca el ejecutable de Claude Code. En Windows, si solo está `claude.cmd` de npm, usa el
/// `claude.exe` que hay dentro del paquete.
pub fn buscar_programa(configurado: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = configurado {
        return Some(PathBuf::from(p));
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        #[cfg(windows)]
        {
            let exe = dir.join("claude.exe");
            if exe.is_file() {
                return Some(exe);
            }
            if dir.join("claude.cmd").is_file() {
                let interno = dir.join(r"node_modules\@anthropic-ai\claude-code\bin\claude.exe");
                if interno.is_file() {
                    return Some(interno);
                }
            }
        }
        #[cfg(not(windows))]
        {
            let p = dir.join("claude");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

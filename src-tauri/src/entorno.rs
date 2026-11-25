//! Inspector de variables de entorno: las que heredan las shells de Kyu (las de su
//! proceso) y los `.env*` de la carpeta del espacio. Solo lectura y solo para enseñar:
//! nada de esto se manda a Claude.

use std::path::Path;

use serde::Serialize;

#[derive(Serialize)]
pub struct Variable {
    nombre: String,
    valor: String,
}

#[derive(Serialize)]
pub struct FicheroEnv {
    nombre: String,
    variables: Vec<Variable>,
}

#[derive(Serialize)]
pub struct EntradaPath {
    ruta: String,
    existe: bool,
}

#[derive(Serialize)]
pub struct Entorno {
    proceso: Vec<Variable>,
    path: Vec<EntradaPath>,
    ficheros: Vec<FicheroEnv>,
}

/// `CLAVE=valor` por línea; `export` delante, comentarios y comillas fuera.
fn leer_env(texto: &str) -> Vec<Variable> {
    texto
        .lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let l = l.strip_prefix("export ").unwrap_or(l);
            let (k, v) = l.split_once('=')?;
            let k = k.trim();
            if k.is_empty() || k.contains(' ') {
                return None;
            }
            let v = v.trim();
            let v = if (v.starts_with('"') && v.ends_with('"') && v.len() >= 2)
                || (v.starts_with('\'') && v.ends_with('\'') && v.len() >= 2)
            {
                &v[1..v.len() - 1]
            } else {
                // Comentario al final solo si no va entre comillas
                v.split(" #").next().unwrap_or(v).trim_end()
            };
            Some(Variable {
                nombre: k.to_string(),
                valor: v.to_string(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn entorno_leer(carpeta: Option<String>) -> Entorno {
    // Las «=C:», «=ExitCode»… son internas de cmd: no dicen nada.
    let mut proceso: Vec<Variable> = std::env::vars()
        .filter(|(n, _)| !n.starts_with('='))
        .map(|(nombre, valor)| Variable { nombre, valor })
        .collect();
    proceso.sort_by_key(|v| v.nombre.to_lowercase());

    let path = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|r| !r.as_os_str().is_empty())
                .map(|r| EntradaPath {
                    existe: r.is_dir(),
                    ruta: r.to_string_lossy().into_owned(),
                })
                .collect()
        })
        .unwrap_or_default();

    let mut ficheros = Vec::new();
    let carpeta_y_lista = carpeta
        .as_deref()
        .map(Path::new)
        .and_then(|c| std::fs::read_dir(c).ok().map(|l| (c, l)));
    if let Some((c, lista)) = carpeta_y_lista {
        let mut nombres: Vec<String> = lista
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n == ".env" || n.starts_with(".env."))
            .collect();
        nombres.sort();
        for nombre in nombres {
            let ruta = c.join(&nombre);
            // Un .env de más de 1 MB no es un .env
            if std::fs::metadata(&ruta)
                .map(|m| m.len() > 1 << 20)
                .unwrap_or(true)
            {
                continue;
            }
            if let Ok(texto) = std::fs::read_to_string(&ruta) {
                ficheros.push(FicheroEnv {
                    nombre,
                    variables: leer_env(&texto),
                });
            }
        }
    }

    Entorno {
        proceso,
        path,
        ficheros,
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn env() {
        let v = leer_env(
            "# comentario\nA=1\nexport B=\"dos tres\"\nC='x=y'\nD=valor # nota\n\nmal linea\nE=\n",
        );
        let pares: Vec<(&str, &str)> = v
            .iter()
            .map(|x| (x.nombre.as_str(), x.valor.as_str()))
            .collect();
        assert_eq!(
            pares,
            vec![
                ("A", "1"),
                ("B", "dos tres"),
                ("C", "x=y"),
                ("D", "valor"),
                ("E", "")
            ]
        );
    }
}

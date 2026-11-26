//! Varias cuentas de Antigravity en Windows. `agy` guarda su sesión de Google en el
//! Administrador de credenciales con un destino fijo (`gemini:antigravity`) y no hay forma de
//! separarla por carpeta, así que Kyu la intercambia: cada cuenta tiene su copia en
//! `kyu:antigravity:<nombre>` y, antes de lanzar `agy`, la de la cuenta elegida pasa a
//! `gemini:antigravity`. Antes de cambiar, lo que haya ahí se copia a la cuenta que estaba
//! activa (así se conservan los tokens que `agy` haya refrescado).
//!
//! Dos `agy` con cuentas distintas a la vez no se permiten: el primero, al refrescar su token,
//! lo escribiría en `gemini:antigravity` y acabaría guardado como si fuera del otro.

use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::Serialize;

use crate::config::Config;

/// Nombre de la cuenta de siempre cuando se añade la segunda.
const PRINCIPAL: &str = "Principal";

#[cfg(any(windows, test))]
/// Dónde vive cada cosa en el Administrador de credenciales.
#[derive(Clone, Copy)]
pub struct Destinos {
    /// La que lee `agy`.
    pub agy: &'static str,
    /// Prefijo de la copia de cada cuenta.
    pub prefijo: &'static str,
    /// Nombre de la cuenta cuya sesión está ahora en `agy`.
    pub activa: &'static str,
}

#[cfg(any(windows, test))]
const REALES: Destinos = Destinos {
    agy: "gemini:antigravity",
    prefijo: "kyu:antigravity:",
    activa: "kyu:antigravity-activa",
};

static CANDADO: OnceLock<Mutex<()>> = OnceLock::new();
/// Cuentas con un `agy` abierto ahora (una entrada por proceso).
static EN_USO: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn candado() -> MutexGuard<'static, ()> {
    CANDADO
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn en_uso() -> MutexGuard<'static, Vec<String>> {
    EN_USO
        .get_or_init(|| Mutex::new(Vec::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize)]
pub struct CuentaAntigravityVista {
    pub nombre: String,
    pub principal: bool,
    pub sesion: bool,
    pub activa: bool,
    /// Hay una conversación de Antigravity abierta con ella.
    pub abierta: bool,
}

#[cfg(any(windows, test))]
/// Almacén de credenciales: el de Windows o, en las pruebas, uno en memoria.
pub trait Almacen {
    fn leer(&self, destino: &str) -> Option<Cred>;
    fn escribir(&self, destino: &str, c: &Cred) -> Result<(), String>;
    fn borrar(&self, destino: &str) -> Result<(), String>;
}

#[cfg(any(windows, test))]
#[derive(Clone, Debug, PartialEq)]
pub struct Cred {
    pub usuario: String,
    pub blob: Vec<u8>,
    pub persist: u32,
}

#[cfg(any(windows, test))]
/// Lógica del intercambio, separada del almacén para poder probarla.
pub struct Intercambio<'a, A: Almacen> {
    pub almacen: &'a A,
    pub d: Destinos,
}

#[cfg(any(windows, test))]
impl<A: Almacen> Intercambio<'_, A> {
    fn copia(&self, nombre: &str) -> String {
        format!("{}{nombre}", self.d.prefijo)
    }

    pub fn activa(&self) -> Option<String> {
        let c = self.almacen.leer(self.d.activa)?;
        String::from_utf8(c.blob).ok().filter(|s| !s.is_empty())
    }

    fn poner_activa(&self, nombre: &str) -> Result<(), String> {
        self.almacen.escribir(
            self.d.activa,
            &Cred {
                usuario: "kyu".into(),
                blob: nombre.as_bytes().to_vec(),
                persist: 2, // CRED_PERSIST_LOCAL_MACHINE
            },
        )
    }

    /// Copia lo que hay en `agy` a la cuenta que lo tiene (sin activa apuntada: la principal).
    fn guardar_actual(&self, principal: &str) -> Result<String, String> {
        let duena = self.activa().unwrap_or_else(|| principal.to_string());
        if let Some(actual) = self.almacen.leer(self.d.agy) {
            self.almacen.escribir(&self.copia(&duena), &actual)?;
            // Comprobar que la copia está antes de tocar nada más.
            if self.almacen.leer(&self.copia(&duena)).as_ref() != Some(&actual) {
                return Err(format!(
                    "no se pudo guardar la sesión de «{duena}»: no cambio de cuenta"
                ));
            }
        }
        Ok(duena)
    }

    /// Deja en `agy` la sesión de `nombre`. Si `nombre` no tiene sesión guardada, `agy` queda
    /// vacío (pedirá iniciar sesión).
    pub fn activar(&self, nombre: &str, principal: &str) -> Result<(), String> {
        let duena = self.guardar_actual(principal)?;
        if duena != nombre {
            match self.almacen.leer(&self.copia(nombre)) {
                Some(g) => self.almacen.escribir(self.d.agy, &g)?,
                None => self.almacen.borrar(self.d.agy)?,
            }
        }
        self.poner_activa(nombre)
    }

    pub fn tiene_sesion(&self, nombre: &str, principal: &str) -> bool {
        let activa = self.activa().unwrap_or_else(|| principal.to_string());
        if activa == nombre {
            self.almacen.leer(self.d.agy).is_some()
        } else {
            self.almacen.leer(&self.copia(nombre)).is_some()
        }
    }
}

#[cfg(windows)]
mod windows_cred {
    use super::{Almacen, Cred};
    use std::ffi::c_void;
    use std::ptr;
    use windows::Win32::Security::Credentials::{
        CRED_PERSIST, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
    };
    use windows::core::{PCWSTR, PWSTR};

    pub struct Windows;

    fn a_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    impl Almacen for Windows {
        fn leer(&self, destino: &str) -> Option<Cred> {
            let w = a_wide(destino);
            let mut p: *mut CREDENTIALW = ptr::null_mut();
            unsafe {
                if CredReadW(PCWSTR(w.as_ptr()), CRED_TYPE_GENERIC, None, &mut p).is_err()
                    || p.is_null()
                {
                    return None;
                }
                let c = &*p;
                let blob = if c.CredentialBlob.is_null() || c.CredentialBlobSize == 0 {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize)
                        .to_vec()
                };
                let usuario = if c.UserName.is_null() {
                    String::new()
                } else {
                    c.UserName.to_string().unwrap_or_default()
                };
                let res = Cred {
                    usuario,
                    blob,
                    persist: c.Persist.0,
                };
                CredFree(p as *const c_void);
                Some(res)
            }
        }

        fn escribir(&self, destino: &str, c: &Cred) -> Result<(), String> {
            let mut w_dest = a_wide(destino);
            let mut w_user = a_wide(&c.usuario);
            let mut blob = c.blob.clone();
            let cred = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: PWSTR(w_dest.as_mut_ptr()),
                CredentialBlobSize: blob.len() as u32,
                CredentialBlob: if blob.is_empty() {
                    ptr::null_mut()
                } else {
                    blob.as_mut_ptr()
                },
                Persist: CRED_PERSIST(c.persist),
                UserName: PWSTR(w_user.as_mut_ptr()),
                ..Default::default()
            };
            unsafe { CredWriteW(&cred, 0) }
                .map_err(|e| format!("no se pudo guardar la credencial {destino}: {e}"))
        }

        fn borrar(&self, destino: &str) -> Result<(), String> {
            let w = a_wide(destino);
            match unsafe { CredDeleteW(PCWSTR(w.as_ptr()), CRED_TYPE_GENERIC, None) } {
                Ok(()) => Ok(()),
                // ERROR_NOT_FOUND: ya no estaba.
                Err(e) if e.code().0 as u32 == 0x8007_0490 => Ok(()),
                Err(e) => Err(format!("no se pudo borrar la credencial {destino}: {e}")),
            }
        }
    }
}

#[cfg(windows)]
fn intercambio() -> Intercambio<'static, windows_cred::Windows> {
    static W: windows_cred::Windows = windows_cred::Windows;
    Intercambio {
        almacen: &W,
        d: REALES,
    }
}

fn nombres(config: &Config) -> Vec<String> {
    config
        .cuentas_antigravity
        .iter()
        .map(|c| c.nombre.clone())
        .collect()
}

/// Mientras vive, la cuenta cuenta como abierta (va dentro de la sesión ACP).
pub struct Uso(String);

impl Drop for Uso {
    fn drop(&mut self) {
        let mut l = en_uso();
        if let Some(i) = l.iter().position(|n| n == &self.0) {
            l.remove(i);
        }
    }
}

/// Antes de lanzar `agy`: pone la sesión de `cuenta` (o de la primera de kyu.toml) y la marca
/// como abierta. Sin cuentas en kyu.toml no toca nada. Falla si hay otro `agy` abierto con
/// otra cuenta.
pub fn ocupar(cuenta: Option<&str>) -> Result<Option<Uso>, String> {
    let config = Config::cargar();
    let lista = nombres(&config);
    let Some(principal) = lista.first() else {
        return Ok(None);
    };
    let elegida = cuenta
        .filter(|n| lista.iter().any(|x| x == n))
        .unwrap_or(principal)
        .to_string();
    let _g = candado();
    let mut uso = en_uso();
    if let Some(otra) = uso.iter().find(|n| **n != elegida) {
        return Err(format!(
            "Antigravity ya está abierto con la cuenta «{otra}». Las cuentas de Antigravity comparten la sesión de Windows: cierra esa conversación (o pásala a «{elegida}») y vuelve a probar."
        ));
    }
    #[cfg(windows)]
    intercambio().activar(&elegida, principal)?;
    uso.push(elegida.clone());
    Ok(Some(Uso(elegida)))
}

/// Para preguntar algo a `agy` sin cambiar de cuenta (lista de conversaciones): usa la que
/// esté puesta.
pub fn ocupar_la_actual() -> Option<Uso> {
    let config = Config::cargar();
    let lista = nombres(&config);
    let principal = lista.first()?;
    let _g = candado();
    #[cfg(windows)]
    let actual = intercambio().activa().unwrap_or_else(|| principal.clone());
    #[cfg(not(windows))]
    let actual = principal.clone();
    en_uso().push(actual.clone());
    Some(Uso(actual))
}

#[tauri::command]
pub fn antigravity_cuentas() -> Vec<CuentaAntigravityVista> {
    let config = Config::cargar();
    let lista = nombres(&config);
    let _g = candado();
    let abiertas = en_uso().clone();
    #[cfg(windows)]
    {
        let i = intercambio();
        if lista.is_empty() {
            return vec![CuentaAntigravityVista {
                nombre: PRINCIPAL.into(),
                principal: true,
                sesion: i.almacen.leer(i.d.agy).is_some(),
                activa: true,
                abierta: !abiertas.is_empty(),
            }];
        }
        let principal = &lista[0];
        let activa = i.activa().unwrap_or_else(|| principal.clone());
        lista
            .iter()
            .enumerate()
            .map(|(n, nombre)| CuentaAntigravityVista {
                nombre: nombre.clone(),
                principal: n == 0,
                sesion: i.tiene_sesion(nombre, principal),
                activa: *nombre == activa,
                abierta: abiertas.contains(nombre),
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let _ = (lista, abiertas);
        Vec::new()
    }
}

/// Inicia sesión con esa cuenta: pone su credencial (vacía si es nueva) y abre `agy acp --login`.
#[tauri::command]
pub fn antigravity_cuenta_entrar(nombre: String) -> Result<(), String> {
    let uso = ocupar(Some(&nombre))?;
    // La consola de inicio de sesión vive por su cuenta: no se puede saber cuándo acaba, así
    // que la cuenta deja de contar como abierta en cuanto se lanza.
    drop(uso);
    crate::acp::abrir_login("antigravity")
}

#[tauri::command]
pub fn antigravity_cuenta_anadir(nombre: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("varias cuentas de Antigravity solo funcionan en Windows".into());
    }
    let nombre = nombre.trim().to_string();
    if nombre.is_empty() {
        return Err("ponle un nombre".into());
    }
    let mut doc = crate::ajustes::leer_documento()?;
    let lista = doc
        .entry("cuentas_antigravity")
        .or_insert(toml_edit::Item::ArrayOfTables(
            toml_edit::ArrayOfTables::new(),
        ))
        .as_array_of_tables_mut()
        .ok_or("cuentas_antigravity no es una lista de tablas en kyu.toml")?;
    let existe = |l: &toml_edit::ArrayOfTables, n: &str| {
        l.iter()
            .any(|t| t.get("nombre").and_then(|v| v.as_str()) == Some(n))
    };
    if existe(lista, &nombre) || (lista.is_empty() && nombre == PRINCIPAL) {
        return Err(format!("ya hay una cuenta «{nombre}»"));
    }
    if lista.is_empty() {
        // La sesión de ahora es la de la principal.
        let mut principal = toml_edit::Table::new();
        principal["nombre"] = toml_edit::value(PRINCIPAL);
        lista.push(principal);
    }
    let mut nueva = toml_edit::Table::new();
    nueva["nombre"] = toml_edit::value(nombre.as_str());
    lista.push(nueva);
    crate::ajustes::escribir_documento(&doc)
}

/// La quita de kyu.toml; su copia en el Administrador de credenciales se queda (si se vuelve a
/// añadir con el mismo nombre, sigue iniciada). Si solo queda la principal, vuelve a ponerse
/// su sesión y se quita la lista.
#[tauri::command]
pub fn antigravity_cuenta_quitar(nombre: String) -> Result<(), String> {
    let config = Config::cargar();
    let lista = nombres(&config);
    if lista.first() == Some(&nombre) {
        return Err("la principal no se quita".into());
    }
    if en_uso().contains(&nombre) {
        return Err(format!(
            "hay una conversación de Antigravity abierta con «{nombre}»: ciérrala antes"
        ));
    }
    let mut doc = crate::ajustes::leer_documento()?;
    let tablas = doc["cuentas_antigravity"]
        .as_array_of_tables_mut()
        .ok_or("no hay cuentas de Antigravity en kyu.toml")?;
    let antes = tablas.len();
    tablas.retain(|t| t.get("nombre").and_then(|v| v.as_str()) != Some(nombre.as_str()));
    if tablas.len() == antes {
        return Err(format!("no hay ninguna cuenta «{nombre}»"));
    }
    if tablas.len() <= 1 {
        #[cfg(windows)]
        if let Some(principal) = lista.first() {
            let _g = candado();
            if !en_uso().is_empty() {
                return Err("cierra antes las conversaciones de Antigravity".into());
            }
            intercambio().activar(principal, principal)?;
        }
        doc.remove("cuentas_antigravity");
    }
    crate::ajustes::escribir_documento(&doc)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Memoria(RefCell<HashMap<String, Cred>>);

    impl Almacen for Memoria {
        fn leer(&self, d: &str) -> Option<Cred> {
            self.0.borrow().get(d).cloned()
        }
        fn escribir(&self, d: &str, c: &Cred) -> Result<(), String> {
            self.0.borrow_mut().insert(d.into(), c.clone());
            Ok(())
        }
        fn borrar(&self, d: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(d);
            Ok(())
        }
    }

    fn cred(s: &str) -> Cred {
        Cred {
            usuario: "antigravity".into(),
            blob: s.as_bytes().to_vec(),
            persist: 2,
        }
    }

    fn agy(m: &Memoria) -> Option<String> {
        m.leer(REALES.agy)
            .map(|c| String::from_utf8(c.blob).unwrap())
    }

    #[test]
    fn cambiar_de_cuenta_no_pierde_ninguna_sesion() {
        let m = Memoria::default();
        let i = Intercambio {
            almacen: &m,
            d: REALES,
        };
        m.escribir(REALES.agy, &cred("token-principal")).unwrap();

        // Segunda cuenta sin sesión: agy queda vacío y la principal guardada.
        i.activar("Trabajo", "Principal").unwrap();
        assert_eq!(agy(&m), None);
        assert!(i.tiene_sesion("Principal", "Principal"));
        assert!(!i.tiene_sesion("Trabajo", "Principal"));

        // Inicia sesión con la segunda (lo hace agy).
        m.escribir(REALES.agy, &cred("token-trabajo")).unwrap();
        i.activar("Principal", "Principal").unwrap();
        assert_eq!(agy(&m).as_deref(), Some("token-principal"));

        // agy refresca el token de la principal; al volver a Trabajo se guarda el nuevo.
        m.escribir(REALES.agy, &cred("token-principal-2")).unwrap();
        i.activar("Trabajo", "Principal").unwrap();
        assert_eq!(agy(&m).as_deref(), Some("token-trabajo"));
        i.activar("Principal", "Principal").unwrap();
        assert_eq!(agy(&m).as_deref(), Some("token-principal-2"));

        // Activar la misma no cambia nada.
        i.activar("Principal", "Principal").unwrap();
        assert_eq!(agy(&m).as_deref(), Some("token-principal-2"));
    }

    /// Con el Administrador de credenciales de verdad, en destinos de prueba que se borran.
    #[cfg(windows)]
    #[test]
    fn el_almacen_de_windows_guarda_lee_y_borra() {
        let w = windows_cred::Windows;
        let d = Destinos {
            agy: "kyu-prueba:agy",
            prefijo: "kyu-prueba:cuenta:",
            activa: "kyu-prueba:activa",
        };
        let i = Intercambio { almacen: &w, d };
        w.escribir(d.agy, &cred("uno")).unwrap();
        i.activar("Otra", "Principal").unwrap();
        assert!(w.leer(d.agy).is_none());
        assert_eq!(w.leer("kyu-prueba:cuenta:Principal"), Some(cred("uno")));
        i.activar("Principal", "Principal").unwrap();
        assert_eq!(w.leer(d.agy), Some(cred("uno")));
        assert_eq!(i.activa().as_deref(), Some("Principal"));
        for x in [d.agy, d.activa, "kyu-prueba:cuenta:Principal"] {
            w.borrar(x).unwrap();
            assert!(w.leer(x).is_none());
        }
        w.borrar(d.agy).unwrap(); // borrar lo que no está no falla
    }
}

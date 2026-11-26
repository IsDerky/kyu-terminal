import { memo, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";

// Shiki se carga al primer bloque de código (y cada lenguaje, la primera vez que sale).
let shiki: Promise<typeof import("shiki")> | null = null;
const cache = new Map<string, string>();

async function colorear(codigo: string, lenguaje: string): Promise<string> {
  const clave = `${lenguaje}\0${codigo}`;
  const hecho = cache.get(clave);
  if (hecho) return hecho;
  shiki ??= import("shiki");
  const { codeToHtml, bundledLanguages } = await shiki;
  const lang = lenguaje in bundledLanguages ? lenguaje : "text";
  const html = await codeToHtml(codigo, { lang, theme: "github-dark-default" });
  cache.set(clave, html);
  return html;
}

function Bloque({ codigo, lenguaje }: { codigo: string; lenguaje: string }) {
  const [html, setHtml] = useState<string | null>(() => cache.get(`${lenguaje}\0${codigo}`) ?? null);
  useEffect(() => {
    let vivo = true;
    // Mientras Claude escribe, el bloque cambia a cada trozo: se espera un poco.
    const t = setTimeout(() => void colorear(codigo, lenguaje).then((h) => vivo && setHtml(h)), html ? 120 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [codigo, lenguaje]);

  const [copiado, setCopiado] = useState(false);
  const copiar = () =>
    void navigator.clipboard.writeText(codigo).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    });

  return (
    // data-codigo: el menú de clic derecho del mensaje sabe sobre qué bloque se ha pulsado.
    <div data-codigo={codigo} data-lenguaje={lenguaje} className="group/codigo relative my-2 overflow-hidden rounded-lg border border-borde bg-tarjeta">
      {/* Siempre a la vista (no solo al pasar el ratón): copiar es lo que más se hace con un bloque. */}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-1.5 rounded-md bg-tarjeta/90 pl-2">
        {lenguaje && <span className="font-mono text-[10.5px] text-muy">{lenguaje}</span>}
        <button
          type="button"
          title={copiado ? "Copiado" : "Copiar"}
          onClick={copiar}
          className={`grid size-6 place-items-center rounded-md hover:bg-hover ${copiado ? "text-ok" : "text-muy hover:text-texto"}`}
        >
          {copiado ? <Check size={13} strokeWidth={2.2} /> : <Copy size={12} strokeWidth={1.8} />}
        </button>
      </div>
      {html ? (
        <div className="codigo-md" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="codigo-md">
          <code>{codigo}</code>
        </pre>
      )}
    </div>
  );
}

const componentes: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const texto = String(children ?? "");
    const lenguaje = /language-([\w+#-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
    // Bloque (con lenguaje o de varias líneas) o código en línea.
    if (lenguaje || texto.includes("\n")) return <Bloque codigo={texto.replace(/\n$/, "")} lenguaje={lenguaje ?? ""} />;
    return <code className="rounded bg-hover px-[5px] py-px font-mono text-[12px] text-claude2">{children}</code>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:/.test(href)) void openUrl(href);
      }}
      className="text-acento2 underline decoration-acento/40 underline-offset-2">
      {children}
    </a>
  ),
};

/** Texto de Claude en Markdown (con tablas y listas de tareas). */
export default memo(function Markdown({ texto }: { texto: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={componentes}>
        {texto}
      </ReactMarkdown>
    </div>
  );
});

import { Fragment } from "react";
import { Group, Panel as Hueco, Separator } from "react-resizable-panels";
import { paneles, type Espacio as EspacioT, type Nodo } from "../lib/estado";
import type { ConfigVista } from "../lib/nucleo";
import Panel from "./Panel";
import { alCambiarTamano } from "../lib/restaurar";

interface Props {
  espacio: EspacioT;
  config: ConfigVista;
}

/** Un espacio de trabajo: su árbol de paneles divididos, redimensionables. */
export default function Espacio({ espacio, config }: Props) {
  const varios = paneles(espacio.raiz).length > 1;
  return (
    <div className="min-h-0 min-w-0 flex-1">
      <Arbol nodo={espacio.raiz} foco={espacio.foco} varios={varios} config={config} />
    </div>
  );
}

function Arbol({ nodo, foco, varios, config }: { nodo: Nodo; foco: string; varios: boolean; config: ConfigVista }) {
  if (nodo.tipo === "panel") {
    return <Panel panel={nodo} conFoco={nodo.id === foco} varios={varios} config={config} />;
  }
  const horizontal = nodo.dir === "horizontal";
  // Tamaños guardados (al restaurar) si siguen encajando con los hijos; si no, a partes iguales.
  const guardados = nodo.tamanos?.length === nodo.hijos.length ? nodo.tamanos : null;
  return (
    <Group key={nodo.id} orientation={nodo.dir} className="h-full w-full" onLayoutChanged={(l) => alCambiarTamano(nodo.id, l)}>
      {nodo.hijos.map((hijo, i) => (
        <Fragment key={hijo.id}>
          {i > 0 && (
            <Separator
              className={`relative flex-none bg-borde transition-colors hover:bg-acento/60 data-[separator=active]:bg-acento ${
                horizontal ? "w-px" : "h-px"
              }`}
            />
          )}
          <Hueco id={hijo.id} defaultSize={`${guardados ? guardados[i] : 100 / nodo.hijos.length}`} minSize={horizontal ? 180 : 90}>
            <Arbol nodo={hijo} foco={foco} varios={varios} config={config} />
          </Hueco>
        </Fragment>
      ))}
    </Group>
  );
}

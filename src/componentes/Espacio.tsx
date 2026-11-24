import { Fragment } from "react";
import { Group, Panel as Hueco, Separator } from "react-resizable-panels";
import { paneles, type Espacio as EspacioT, type Nodo } from "../lib/estado";
import type { ConfigVista } from "../lib/nucleo";
import Panel from "./Panel";

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
  return (
    <Group key={nodo.id} orientation={nodo.dir} className="h-full w-full">
      {nodo.hijos.map((hijo, i) => (
        <Fragment key={hijo.id}>
          {i > 0 && (
            <Separator
              className={`relative flex-none bg-borde transition-colors hover:bg-acento/60 data-[separator=active]:bg-acento ${
                horizontal ? "w-px" : "h-px"
              }`}
            />
          )}
          <Hueco id={hijo.id} defaultSize={`${100 / nodo.hijos.length}`} minSize={horizontal ? 180 : 90}>
            <Arbol nodo={hijo} foco={foco} varios={varios} config={config} />
          </Hueco>
        </Fragment>
      ))}
    </Group>
  );
}

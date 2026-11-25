import { Fragment } from "react";
import { Group, Panel as Hueco, Separator } from "react-resizable-panels";
import { paneles, type Espacio as EspacioT, type Nodo } from "../lib/estado";
import type { ConfigVista } from "../lib/nucleo";
import Panel from "./Panel";
import { alCambiarTamano } from "../lib/restaurar";
import { repartoInicial } from "../lib/tamanos";

interface Props {
  espacio: EspacioT;
  config: ConfigVista;
}

/** Un espacio de trabajo: su árbol de paneles divididos, redimensionables. */
export default function Espacio({ espacio, config }: Props) {
  const lista = paneles(espacio.raiz);
  const varios = lista.length > 1;
  // Ctrl+Mayús+X: solo el panel con el foco, a pantalla completa.
  const grande = espacio.maximizado && espacio.maximizado === espacio.foco ? lista.find((p) => p.id === espacio.maximizado) : undefined;
  return (
    <div className="min-h-0 min-w-0 flex-1">
      {grande ? (
        <Panel panel={grande} conFoco varios={false} config={config} maximizado />
      ) : (
        <Arbol nodo={espacio.raiz} foco={espacio.foco} varios={varios} config={config} />
      )}
    </div>
  );
}

function Arbol({ nodo, foco, varios, config }: { nodo: Nodo; foco: string; varios: boolean; config: ConfigVista }) {
  if (nodo.tipo === "panel") {
    return <Panel panel={nodo} conFoco={nodo.id === foco} varios={varios} config={config} />;
  }
  const horizontal = nodo.dir === "horizontal";
  // Lo último que dejó el ratón (heredado si un hijo cambió de id al dividir o cerrar), lo
  // guardado al restaurar, o a partes iguales para lo que no tenga tamaño.
  const reparto = repartoInicial(nodo.id, nodo.hijos.map((h) => h.id), nodo.tamanos);
  return (
    <Group
      key={nodo.id}
      orientation={nodo.dir}
      className="h-full w-full"
      defaultLayout={reparto}
      onLayoutChanged={(l) => alCambiarTamano(nodo.id, l)}
    >
      {nodo.hijos.map((hijo, i) => (
        <Fragment key={hijo.id}>
          {i > 0 && (
            <Separator
              className={`relative flex-none bg-borde transition-colors hover:bg-acento/60 data-[separator=active]:bg-acento ${
                horizontal ? "w-px" : "h-px"
              }`}
            />
          )}
          <Hueco id={hijo.id} defaultSize={`${reparto[hijo.id]}`} minSize={horizontal ? 180 : 90}>
            <Arbol nodo={hijo} foco={foco} varios={varios} config={config} />
          </Hueco>
        </Fragment>
      ))}
    </Group>
  );
}

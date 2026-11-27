// Claude: conversaciones en pestañas de panel («espacio~pN»), cada una con su proceso de
// Claude Code (src-tauri/src/claude.rs). El proceso se arranca con el primer mensaje, en la
// carpeta del terminal con el foco.
//
// Por dentro está partido en src/lib/claude/; aquí solo se reexporta para que el resto
// siga importando de "./claude".
export * from "./claude/estado";
export * from "./claude/sitios";
export * from "./claude/eventos";
export * from "./claude/adjuntos";
export * from "./claude/comandos";
export * from "./claude/ajustes";
export * from "./claude/turno";
export * from "./claude/vuelta";

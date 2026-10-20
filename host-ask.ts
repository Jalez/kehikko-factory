import { resolveDoorProject, type DoorProject } from 'kehikot-module-protocol/serve'

/**
 * Which project is this folder? Asked of the host, in this server, before any folder a request names
 * is read or written (protocol 2.3.0, `resolveDoorProject`). A page's word, an agent's, or a skill's
 * is not the host's. The answer's `path` is what is used, never the folder that was named.
 */
export type Resolve = (folder: string) => Promise<DoorProject>

export const resolveProject: Resolve = (folder) => resolveDoorProject(folder)

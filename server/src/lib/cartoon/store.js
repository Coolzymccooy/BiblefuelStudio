import { createProjectStore } from "../sceneScript/projectStore.js";

/**
 * Cartoon projects: the same atomic one-file-per-project store as scene
 * scripts, bound to its own "cartoons" folder (data and outputs) so the two
 * modes never list or serve each other's projects. Listed rows carry
 * mode: "cartoon" so a client showing both can tell them apart.
 */

const store = createProjectStore("cartoons");

export const isProjectId = store.isProjectId;
export const readProject = store.readProject;
export const writeProject = store.writeProject;
export const updateProject = store.updateProject;
export const createProject = store.createProject;
export const deleteProject = store.deleteProject;
export const projectOutputDir = store.projectOutputDir;
export const projectOutputUrl = store.projectOutputUrl;

export function listProjects(baseDir) {
  return store.listProjects(baseDir).map((row) => ({ ...row, mode: "cartoon" }));
}

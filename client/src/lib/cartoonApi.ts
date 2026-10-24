import { api } from './api';
import { ApiError } from './apiError';
import type {
  CartoonCheck, CartoonEdit, CartoonEstimate, CartoonExample, CartoonMonth, CartoonPreview, CartoonProject,
  CartoonStyle, CartoonSummary, ShelfCharacter,
} from './cartoonTypes';

type Res = { ok: boolean; status?: number; data?: any; error?: string };

/**
 * A failed response as an ApiError carrying the server's sentence and code.
 * The whole body stays on `payload`, so extra fields (NOT_READY `blockers`,
 * CAST_NOT_READY `waiting`, OVER_BENCHMARK `estimate`) remain reachable.
 */
function failure(res: Res, fallback: string): ApiError {
  const body = res.data ?? {};
  const human = typeof body.error === 'string' && body.error ? body.error : res.error;
  return new ApiError(human || fallback, typeof body.code === 'string' ? body.code : '', body, res.status);
}

function project(res: Res, fallback: string): CartoonProject {
  if (!res.ok || !res.data?.project) throw failure(res, fallback);
  return res.data.project as CartoonProject;
}

const base = '/api/cartoon';
const enc = encodeURIComponent;

// The server gives the writer 60 s and looks a verse up for up to 10 s before saving.
const WRITE_TIMEOUT_MS = 75_000;
const CREATE_TIMEOUT_MS = 30_000;

export interface WriteRequest { verse?: string; theme?: string; cast?: string; style?: string }

export interface FilmOptions {
  /** Shot ids to order (or re-make); omit to order every shot without a finished clip. */
  only?: string[];
  /** Go ahead although the total is above the benchmark (the server answers OVER_BENCHMARK otherwise). */
  confirmOverBenchmark?: boolean;
}

export const cartoonApi = {
  async styles(): Promise<{ styles: CartoonStyle[]; defaultStyle: string }> {
    const res = await api.get(`${base}/styles`);
    if (!res.ok) throw failure(res, 'Could not load the cartoon styles');
    return { styles: res.data.styles as CartoonStyle[], defaultStyle: res.data.defaultStyle as string };
  },
  async examples(): Promise<{ examples: CartoonExample[]; placeholder: string }> {
    const res = await api.get(`${base}/examples`);
    if (!res.ok) throw failure(res, 'Could not load the examples');
    return { examples: res.data.examples as CartoonExample[], placeholder: res.data.placeholder as string };
  },
  async list(): Promise<CartoonSummary[]> {
    const res = await api.get(base);
    if (!res.ok) throw failure(res, 'Could not load cartoons');
    return res.data.projects as CartoonSummary[];
  },
  async parse(markdown: string): Promise<{ preview: CartoonPreview; check: CartoonCheck; fits: boolean; estimate: CartoonEstimate }> {
    const res = await api.post(`${base}/parse`, { markdown });
    if (!res.ok) throw failure(res, 'Could not read the script');
    return { preview: res.data.preview, check: res.data.check, fits: Boolean(res.data.fits), estimate: res.data.estimate };
  },
  /** Save a new cartoon from an example (by id) or from pasted script text. */
  async create(input: { exampleId: string } | { markdown: string }): Promise<CartoonProject> {
    return project(await api.post(base, input, undefined, { timeout: CREATE_TIMEOUT_MS }), 'Could not save the cartoon');
  },
  /** Have BibleFuel draft a script; the text is shown for editing, nothing is saved. */
  async write(input: WriteRequest): Promise<{ markdown: string; verseText: string }> {
    const res = await api.post(`${base}/write`, input, undefined, { timeout: WRITE_TIMEOUT_MS });
    if (!res.ok) throw failure(res, 'Could not write the script');
    return { markdown: res.data.markdown as string, verseText: (res.data.verseText as string) ?? '' };
  },
  async get(id: string): Promise<{ project: CartoonProject; month: CartoonMonth; seedance: boolean }> {
    const res = await api.get(`${base}/${enc(id)}`);
    if (!res.ok || !res.data?.project) throw failure(res, 'Could not load the cartoon');
    return { project: res.data.project, month: res.data.month, seedance: Boolean(res.data.seedance) };
  },
  async update(id: string, edit: CartoonEdit): Promise<CartoonProject> {
    return project(await api.patch(`${base}/${enc(id)}`, edit), 'Could not save the change');
  },
  async remove(id: string): Promise<void> {
    const res = await api.delete(`${base}/${enc(id)}`);
    if (!res.ok) throw failure(res, 'Could not delete the cartoon');
  },
  /** Start making portraits in the background (all without one, or just `only`); poll `get` for progress. */
  async portraits(id: string, only?: string[]): Promise<CartoonProject> {
    return project(await api.post(`${base}/${enc(id)}/portraits`, only ? { only } : {}), 'Could not start the portraits');
  },
  async approvePortrait(id: string, name: string): Promise<CartoonProject> {
    return project(await api.post(`${base}/${enc(id)}/cast/${enc(name)}/approve`, {}), 'Could not approve the portrait');
  },
  async shelf(): Promise<ShelfCharacter[]> {
    const res = await api.get(`${base}/shelf`);
    if (!res.ok) throw failure(res, 'Could not load the character shelf');
    return res.data.characters as ShelfCharacter[];
  },
  /** Save an approved character to the shelf. */
  async shelve(id: string, name: string): Promise<ShelfCharacter> {
    const res = await api.post(`${base}/${enc(id)}/cast/${enc(name)}/shelve`, {});
    if (!res.ok || !res.data?.character) throw failure(res, 'Could not save the character to the shelf');
    return res.data.character as ShelfCharacter;
  },
  /** Pull a shelf character into this cartoon, approved; `asName` renames it. */
  async fromShelf(id: string, characterId: string, asName?: string): Promise<CartoonProject> {
    const body = asName === undefined ? { characterId } : { characterId, asName };
    return project(await api.post(`${base}/${enc(id)}/cast/from-shelf`, body), 'Could not add the character');
  },
  async removeFromShelf(characterId: string): Promise<void> {
    const res = await api.delete(`${base}/shelf/${enc(characterId)}`);
    if (!res.ok) throw failure(res, 'Could not remove the character from the shelf');
  },
  async approveShots(id: string): Promise<CartoonProject> {
    return project(await api.post(`${base}/${enc(id)}/shots/approve`, {}), 'Could not approve the shot list');
  },
  /** What ordering would cost, with this month's spend, before anything is ordered. */
  async estimate(id: string, only?: string[]): Promise<{ estimate: CartoonEstimate; month: CartoonMonth }> {
    const res = await api.post(`${base}/${enc(id)}/film/estimate`, only ? { only } : {});
    if (!res.ok) throw failure(res, 'Could not work out the price');
    return { estimate: res.data.estimate, month: res.data.month };
  },
  /** Order the clips; paid. Runs in the background, so poll `get`. */
  async film(id: string, opts: FilmOptions = {}): Promise<CartoonProject> {
    return project(await api.post(`${base}/${enc(id)}/film`, opts), 'Could not start the film');
  },
  async cancelFilm(id: string): Promise<{ stopping: boolean }> {
    const res = await api.post(`${base}/${enc(id)}/film/cancel`, {});
    if (!res.ok) throw failure(res, 'Could not stop the film');
    return { stopping: Boolean(res.data?.stopping) };
  },
  async render(id: string): Promise<CartoonProject> {
    return project(await api.post(`${base}/${enc(id)}/render`, {}), 'Could not start the render');
  },
  async cancelRender(id: string): Promise<{ stopping: boolean }> {
    const res = await api.post(`${base}/${enc(id)}/render/cancel`, {});
    if (!res.ok) throw failure(res, 'Could not stop the render');
    return { stopping: Boolean(res.data?.stopping) };
  },
};

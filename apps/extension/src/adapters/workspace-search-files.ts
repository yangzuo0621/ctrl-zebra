import type {
  ListFilesRequest,
  ListFilesWorkspace,
  ReadFileRequest,
  ReadFileWorkspace,
  SearchFilesWorkspace,
} from "@ctrl-zebra/builtin-tools";

export class WorkspaceSearchFiles implements SearchFilesWorkspace {
  readonly #lister: ListFilesWorkspace;
  readonly #reader: ReadFileWorkspace;

  constructor(lister: ListFilesWorkspace, reader: ReadFileWorkspace) {
    this.#lister = lister;
    this.#reader = reader;
  }

  findFiles(request: ListFilesRequest, signal: AbortSignal): Promise<unknown> {
    return this.#lister.findFiles(request, signal);
  }

  readFile(request: ReadFileRequest, signal: AbortSignal): Promise<unknown> {
    return this.#reader.readFile(request, signal);
  }
}

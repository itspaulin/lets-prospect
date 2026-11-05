import { handle, type Env } from './handler.js';

export default { fetch: (request: Request, env: Env): Promise<Response> => handle(request, env) };

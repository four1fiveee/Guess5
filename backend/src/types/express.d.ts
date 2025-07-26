// Type declarations for Express
declare module 'express' {
  export interface Request {
    body: any;
    params: any;
    query: any;
  }
  
  export interface Response {
    json: (data: any) => Response;
    status: (code: number) => Response;
    send: (data: any) => Response;
  }
  
  export interface Router {
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
    post: (path: string, handler: (req: Request, res: Response) => void) => void;
    use: (path: string, router: Router) => void;
  }
  
  export default function express(): any;
  export function Router(): Router;
} 
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve('../pridedesk/dist');
export default async function setup(){
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!path.startsWith(root)){res.writeHead(403).end();return;}
  try{const body=await readFile(path);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
}

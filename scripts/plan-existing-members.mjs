import{readFile,writeFile,realpath}from'node:fs/promises';
import{resolve,relative,dirname,basename,isAbsolute,sep,join}from'node:path';
import{fileURLToPath}from'node:url';
import{planLegacyMembers,legacyImportSql}from'./legacy-members.mjs';
const script=fileURLToPath(import.meta.url),repository=resolve(dirname(script),'..');
const outside=(root,path)=>{const rel=relative(root,path);return rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel);};
export async function privateOutputPath(output){
 if(!output)throw Error('private_output_required');
 const target=resolve(output),root=await realpath(repository);
 // Check components, not a textual '..' prefix; cwd is irrelevant.
 if(!outside(repository,target))throw Error('private_output_required');
 const canonical=join(await realpath(dirname(target)),basename(target));
 // An external junction/symlink must not route the output back into the repo.
 if(!outside(root,canonical))throw Error('private_output_required');
 return canonical;
}
// Offline planner only. No OAuth, database connection, write command or apply mode.
if(process.argv[1]&&resolve(process.argv[1])===script){
 try{
  const[sourcePath,membersPath,requestedOutput]=process.argv.slice(2),output=await privateOutputPath(requestedOutput);
  const source=JSON.parse(await readFile(sourcePath,'utf8')),members=JSON.parse(await readFile(membersPath,'utf8')),plan=planLegacyMembers(source,members);
  await writeFile(output,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
  if(plan.complete)await writeFile(output+'.sql',legacyImportSql(source,plan),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({owners:plan.owners,existing:plan.existing.length,candidates:plan.candidates.length,review:plan.review.length}));
 }catch{console.error('Private planning stopped. No SQL executed.');process.exitCode=1;}
}

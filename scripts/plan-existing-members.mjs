import{readFile,writeFile}from'node:fs/promises';import{resolve,relative}from'node:path';import{planLegacyMembers,legacyImportSql}from'./legacy-members.mjs';
// Offline planner only. No OAuth, database connection, write command or apply mode.
try{const[sourcePath,membersPath,output]=process.argv.slice(2);if(!output||!relative(resolve('.'),resolve(output)).startsWith('..'))throw Error('private_output_required');
 const source=JSON.parse(await readFile(sourcePath,'utf8')),members=JSON.parse(await readFile(membersPath,'utf8')),plan=planLegacyMembers(source,members);
 await writeFile(output,JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});if(plan.complete)await writeFile(output+'.sql',legacyImportSql(source,plan),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({owners:plan.owners,existing:plan.existing.length,candidates:plan.candidates.length,review:plan.review.length}));
}catch{console.error('Private planning stopped. No SQL executed.');process.exitCode=1;}

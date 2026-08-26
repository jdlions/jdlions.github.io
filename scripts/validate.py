#!/usr/bin/env python3
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
errors=[]
required=['index.html','login/index.html','student/index.html','admin/index.html','data/issues.json','assets/js/services/service-contracts.js','assets/js/data/mock-data.js','assets/js/services/production-editorial-service.js','worker/src/index.js','worker/migrations/0001_initial.sql','worker/wrangler.toml','README.md','.gitignore']
for name in required:
 if not (root/name).is_file(): errors.append(f'missing {name}')
issues=json.loads((root/'data/issues.json').read_text(encoding='utf-8'))
if len(issues)!=18: errors.append(f'expected 18 public issues, got {len(issues)}')
if sorted(i['number'] for i in issues)!=list(range(16,34)): errors.append('archive issue numbers are not No.16–No.33')
for i in issues:
 if not i['url'].startswith('https://drive.google.com/'): errors.append(f'invalid archive URL: {i["label"]}')
index=(root/'index.html').read_text(encoding='utf-8')
for needle in ['https://lions-pride-editorial-api.editor-936.workers.dev/editorial/login/','id="archive-list"','assets/js/public/archive.js','The Lion\'s Pride — 2026 Winter Edition']:
 if needle not in index: errors.append(f'public integration missing {needle}')
mock=(root/'assets/js/data/mock-data.js').read_text(encoding='utf-8')
for forbidden in ['client_secret','refresh_token','ghp_','AIza']:
 if forbidden in mock: errors.append(f'possible secret marker {forbidden}')
for path in root.glob('assets/js/**/*.js'):
 text=path.read_text(encoding='utf-8')
 if re.search(r'@(gmail|googlemail)\.com',text,re.I): errors.append(f'personal email-like fixture in {path.relative_to(root)}')
 if 'catch' in text and re.search(r'try\s*\{\s*(?:import|require)',text): errors.append(f'import wrapped in try/catch: {path.relative_to(root)}')
gitignore=(root/'.gitignore').read_text(encoding='utf-8')
for needle in ['worker/.dev.vars','worker/.env']:
 if needle not in gitignore: errors.append(f'secret file is not ignored: {needle}')
tracked='\n'.join(str(p.relative_to(root)) for p in root.rglob('*') if p.is_file())
for forbidden in ['worker/.dev.vars','worker/.env.local']:
 if forbidden in tracked: errors.append(f'local secret file exists in tree: {forbidden}')
if errors:
 print('\n'.join('ERROR: '+e for e in errors));sys.exit(1)
print(f'Validated {len(required)} required files, {len(issues)} archive records, public hooks, and fixture secret markers.')

import json,subprocess,collections,sys,os
os.chdir('C:/Users/Owner/Desktop/selfboot')
SP='C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out'; os.makedirs(SP, exist_ok=True)
rows=json.load(open(SP+'/dist.json'))
out={}
for r in rows:
    if r['last'].split()[-1] < '2026-10-16': continue
    p=f"content/seed/quests/{r['name']}/items.json"
    log=subprocess.run(['git','log','--format=%h|%ad|%s','--date=short','--',p],capture_output=True,text=True,encoding='utf-8').stdout.strip().splitlines()
    first=log[-1].split('|')[0]
    old=json.loads(subprocess.run(['git','show',f'{first}:{p}'],capture_output=True,text=True,encoding='utf-8').stdout)['items']
    new=json.load(open(p,encoding='utf-8'))['items']
    oldk=set(i['key'] for i in old)
    added=[i['key'] for i in new if i['key'] not in oldk]
    kinds=collections.Counter(k.split('/')[1] for k in added)
    out[r['name']]=dict(log=log,added=added,addedKinds=dict(kinds))
    print(r['name'], dict(kinds), '|', ' || '.join(log[:3]))
json.dump(out,open(SP+'/newitems.json','w'),indent=1)

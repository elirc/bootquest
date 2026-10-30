import json,sys,os
os.chdir('C:/Users/Owner/Desktop/selfboot')
SP='C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out'; os.makedirs(SP, exist_ok=True)
newi=json.load(open(SP+'/newitems.json'))
onlynew=sys.argv[1]=='new'
out=[]
for pack in sys.argv[2:]:
    added=set(newi.get(pack,{}).get('added',[]))
    d=json.load(open(f'content/seed/quests/{pack}/items.json',encoding='utf-8'))['items']
    out.append(f"\n######## {pack} ({'NEW items only' if onlynew else 'all'})")
    for q in [i for i in d if i['kind']=='quiz']:
        if onlynew and q['key'] not in added: continue
        k=q['check']['answerKey']
        out.append(f"Q[{q['key'].split('/')[-1][:8]}] {q.get('variety')} src={q['provenance']['path'].split('/')[-1]} :: {q['prompt']}")
        out.append("   KEY: "+q['choices'][k]['text'])
        out.append("   dis: "+' | '.join(c['text'] for j,c in enumerate(q['choices']) if j!=k))
    for f in [i for i in d if i['kind']=='flashcard']:
        if onlynew and f['key'] not in added: continue
        out.append(f"F[{f['key'].split('/')[-1][:8]}] {f['front']} => {f['back'][:260]}")
open(SP+'/compact-'+sys.argv[1]+'.txt','w',encoding='utf-8').write('\n'.join(out))
print(len('\n'.join(out)))

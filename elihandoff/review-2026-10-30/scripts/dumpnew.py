import json,sys,os,textwrap
os.chdir('C:/Users/Owner/Desktop/selfboot')
SP='C:/Users/Owner/Desktop/selfboot/elihandoff/review-2026-10-30/scripts/out'; os.makedirs(SP, exist_ok=True)
try: newi=json.load(open(SP+'/newitems.json'))
except Exception: newi={}
def short(k): return k.split('/')[-1][:8]
ONLYNEW=True
for pack in sys.argv[1:]:
    added=set(newi.get(pack,{}).get('added',[]))
    d=json.load(open(f'content/seed/quests/{pack}/items.json',encoding='utf-8'))['items']
    n=json.load(open(f'content/seed/notes/{pack}/items.json',encoding='utf-8'))['items']
    man=json.load(open(f'content/seed/quests/{pack}/manifest.json',encoding='utf-8'))
    out=[]
    out.append(f"#### PACK {pack}  sha={man['source']['sha'][:10]}  inputs={man['source']['inputs']}")
    quizzes=[i for i in d if i['kind']=='quiz']; fcs=[i for i in d if i['kind']=='flashcard']; rs=[i for i in d if i['kind']=='reading-step']
    out.append(f"quizzes={len(quizzes)} flashcards={len(fcs)} reading={len(rs)} notes={len(n)}")
    after={x['target']:x for x in n if x['phase']=='after'}
    for i,q in enumerate(quizzes):
        if ONLYNEW and q['key'] not in added: continue
        tag='NEW' if q['key'] in added else 'old'
        out.append(f"\n--- Q{i+1} [{short(q['key'])}] {tag} variety={q.get('variety')} src={q['provenance']['path']}:{q['provenance']['lines']['start']}-{q['provenance']['lines']['end']} cites={[c['raw'] for c in q.get('citations',[])]}")
        out.append("PROMPT: "+q['prompt'])
        for j,c in enumerate(q['choices']):
            mark='*' if j==q['check']['answerKey'] else ' '
            out.append(f"  {mark} {j}: {c['text']}  {('ev='+str(c['evidence'])) if c.get('evidence') else ''}")
        out.append("EXPL: "+str(q.get('explanation')))
        a=after.get(q['key'])
        if a: out.append(f"AFTER-NOTE [{a['noteId']}] {a['title']}: {a['body']}  | excerpts={[ (e['path'],e['lineStart'],e['lineEnd'],e['quote'][:80]) for e in a.get('excerpts',[])]}")
    for i,f in enumerate(fcs):
        if ONLYNEW and f['key'] not in added: continue
        tag='NEW' if f['key'] in added else 'old'
        out.append(f"\n=== F{i+1} [{short(f['key'])}] {tag} shape={f.get('shape')} label={f.get('label')} src={f['provenance']['path']}:{f['provenance']['lines']['start']} cites={[c['raw'] for c in f.get('citations',[])]}")
        out.append("FRONT: "+f['front']); out.append("BACK: "+f['back'])
    for x in n:
        if x['phase']=='before':
            out.append(f"\n~~~ BEFORE-NOTE [{x['noteId']}] target={x['target']} {x['title']}\n{x['body']}\n excerpts={[ (e['path'],e['lineStart'],e['lineEnd'],e['quote'][:100]) for e in x.get('excerpts',[])]} readMore={[(r['path'],r.get('lineStart'),r.get('lineEnd')) for r in x.get('readMore',[])]}")
    out.append("\n### READING STEPS: "+' | '.join(r['title'][:70] for r in rs))
    open(f"{SP}/packs/{pack}.NEW.txt",'w',encoding='utf-8').write('\n'.join(out))
    print(pack, len(quizzes), len(fcs), len(rs), len(n), 'new:',len(added))

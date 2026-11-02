import json,glob,collections,os,subprocess,sys
ROOT='C:/Users/Owner/Desktop/selfboot'
os.chdir(ROOT)
# campaign map: repo -> (track, act, kind, core, difficulty, repoKind, placement)
camp={}
for tr in ['js','csharp','java']:
    d=json.load(open(f'content/campaign/{tr}.json',encoding='utf-8'))
    for a in d['acts']:
        for q in a['quests']:
            camp.setdefault(q['repo'],[]).append(dict(track=tr,act=a['actNo'],kind=q['kind'],core=q.get('core'),difficulty=q.get('difficulty'),repoKind=q.get('repoKind'),placement=q.get('placement'),focus=q.get('focus'),title=q.get('title'),key=q['key']))
rows=[]
for pdir in sorted(glob.glob('content/seed/quests/*/')):
    name=os.path.basename(os.path.normpath(pdir))
    man=json.load(open(pdir+'manifest.json',encoding='utf-8'))
    items=json.load(open(pdir+'items.json',encoding='utf-8'))['items']
    qz=[i for i in items if i['kind']=='quiz']
    fc=[i for i in items if i['kind']=='flashcard']
    rs=[i for i in items if i['kind']=='reading-step']
    hq=sum(1 for i in qz if i.get('variety')=='concept')
    gq=len(qz)-hq
    hf=sum(1 for i in fc if i.get('shape')=='hand-authored')
    gf=len(fc)-hf
    src=[s for s in man['source']['inputs'] if s.startswith('draft:')]
    rq=man.get('review',0); qu=man.get('quarantined',0)
    # notes count
    try:
        nman=json.load(open(f'content/seed/notes/{name}/manifest.json',encoding='utf-8'))
        notes=nman['counts']['total']
    except Exception: notes=None
    # git first-add date
    try:
        out=subprocess.run(['git','log','--diff-filter=A','--format=%h %ad','--date=short','--follow','--',pdir+'items.json'],capture_output=True,text=True).stdout.strip().splitlines()
        added=out[-1] if out else ''
        out2=subprocess.run(['git','log','-1','--format=%h %ad','--date=short','--',pdir+'items.json'],capture_output=True,text=True).stdout.strip()
    except Exception as e: added='';out2=''
    c=camp.get(name,[])
    tracks='/'.join(sorted(set(x['track'] for x in c))) or '-'
    acts='/'.join(sorted(set(str(x['act']) for x in c))) or '-'
    repoKind=c[0]['repoKind'] if c else '-'
    core=c[0]['core'] if c else None
    rows.append(dict(name=name,track=tracks,act=acts,repoKind=repoKind,core=core,hq=hq,gq=gq,hf=hf,gf=gf,rs=len(rs),notes=notes,review=rq,quar=qu,src=','.join(src),added=added,last=out2,sha=man['source']['sha'][:7],inputs=len(man['source']['inputs'])))
json.dump(rows,open(sys.argv[1],'w'),indent=1)
print(len(rows),'packs')

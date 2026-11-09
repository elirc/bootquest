// Copies the owner DB (opened read-only) to a new file with VACUUM INTO and prints row counts.
// usage: node fable52docs/tools/copydb.cjs C:/path/to/new-sandbox.db   (the target file must not exist yet)
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('C:/Users/Owner/bootquest/bootquest.db',{readOnly:true});
const out=process.argv[2];
db.exec("VACUUM INTO '"+out+"'");
console.log('copied to', out);
const tables=db.prepare("select name from sqlite_master where type='table' order by name").all().map(r=>r.name);
for (const t of tables) console.log(t, db.prepare('select count(*) c from "'+t+'"').get().c);

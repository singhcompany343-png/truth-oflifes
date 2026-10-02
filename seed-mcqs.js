// Idempotent MCQ seeder: guarantees up to 50 questions per learning subject.
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false});
(async()=>{
  const bank=JSON.parse(fs.readFileSync(path.join(__dirname,'mcq-bank.json'),'utf8'));
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const counts=await c.query(`SELECT subject_id,COUNT(*)::int count FROM learning_questions WHERE active=true GROUP BY subject_id`);
    const existing=new Map(counts.rows.map(r=>[Number(r.subject_id),Number(r.count)]));
    const seen={}; let added=0,skipped=0;
    for(const q of bank.questions){
      seen[q.subject_slug]=(seen[q.subject_slug]||0)+1;
      if(seen[q.subject_slug]>50) continue;
      const s=await c.query('SELECT id FROM learning_subjects WHERE slug=$1',[q.subject_slug]);
      if(!s.rowCount) continue;
      const subjectId=s.rows[0].id;
      if((existing.get(Number(subjectId))||0)>=50){skipped++;continue;}
      const exists=await c.query('SELECT id FROM learning_questions WHERE subject_id=$1 AND question=$2 AND chapter=$3',[subjectId,q.question,q.chapter]);
      if(exists.rowCount){skipped++;continue;}
      await c.query('INSERT INTO learning_questions(subject_id,chapter,question,options,correct_index,explanation,difficulty) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)',[subjectId,q.chapter,q.question,JSON.stringify(q.options),q.correct_index,q.explanation,q.difficulty]);
      existing.set(Number(subjectId),(existing.get(Number(subjectId))||0)+1); added++;
    }
    await c.query('COMMIT');
    console.log(`MCQ seed complete: ${added} added, ${skipped} skipped. Target: 50 questions per learning subject.`);
  }catch(e){await c.query('ROLLBACK'); console.warn('MCQ seed skipped:',e.message);}
  finally{c.release();await pool.end();}
})();

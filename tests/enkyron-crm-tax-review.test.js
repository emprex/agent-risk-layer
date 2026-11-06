import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTaxReview,getTaxReviews,recordTaxReview
} from '../desktop/enkyron-crm-tax-review.mjs';

const proposal='11111111-2222-4333-8444-555555555555';
const reviewId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const valid={
  proposal_id:proposal,expected_revision:2,
  buyer_type:'business',buyer_country:'FR',
  service_mode:'human_led_advisory',uk_vat_registration:'unknown',
  overseas_withholding:'not_checked',
  business_evidence:'Company register entry independently checked',
  location_evidence:'Business address verified in France from official registry',
  review_notes:'Check the actual service character and French reverse-charge requirements with the accountant.',
  source_reference:'HMRC Notice 741A / French official information',
  confirmed:true
};
test('tax review stores facts and does NOT infer an exempt or zero-rate treatment',()=>{
  const data=validateTaxReview(valid);
  assert.equal(data.buyer_type,'business');
  assert.equal(data.buyer_country,'FR');
  assert.equal(data.service_mode,'human_led_advisory');
  assert.equal(data.uk_vat_registration,'unknown');
  assert.ok(!('vat_rate' in data));
  assert.ok(!('tax_treatment' in data));
  assert.ok(!('is_exempt' in data));
  assert.equal(validateTaxReview({
    ...valid,buyer_type:'unknown',buyer_country:'',business_evidence:'',
    location_evidence:'',source_reference:''
  }).buyer_country,null);
  assert.equal(validateTaxReview({...valid,buyer_country:'fr'}).buyer_country,'FR');
  for(const attempt of [
    null,{},[],{...valid,proposal_id:'not-a-proposal'},
    {...valid,expected_revision:0},{...valid,expected_revision:'2'},
    {...valid,confirmed:false},{...valid,buyer_type:'company'},
    {...valid,service_mode:'always_reverse_charge'},
    {...valid,uk_vat_registration:'yes'},
    {...valid,overseas_withholding:'none'},
    {...valid,buyer_country:'EU'},
    {...valid,buyer_country:'UK'},
    {...valid,buyer_country:'ZZ'},
    {...valid,buyer_country:1},
    {...valid,buyer_country:'FRA'},
    {...valid,business_evidence:''},
    {...valid,business_evidence:'short'},
    {...valid,location_evidence:''},
    {...valid,location_evidence:'short'},
    {...valid,review_notes:'no idea'},
    {...valid,review_notes:'x'.repeat(2001)},
    {...valid,source_reference:'bad'},
    {...valid,location_evidence:'verified\u0000'}
  ]){
    assert.throws(()=>validateTaxReview(attempt),/CRM/);
  }
});
test('append-only research write checks exact proposal revision and local workspace',async()=>{
  const queries=[];let releases=0;
  const db={connect:async()=>({
    query:async(sql,params)=>{
      queries.push({sql,params});
      if(sql.startsWith('SELECT revision'))return {rows:[{revision:2}]};
      return {rows:[]};
    },release:()=>{releases++;}
  })};
  const result=await recordTaxReview(db,valid,'ci-analyst',{uuid:()=>reviewId});
  assert.equal(result.id,reviewId);
  assert.equal(result.proposal_revision,2);
  assert.deepEqual(queries.map(x=>x.sql.match(/^[A-Z]+/)[0]),[
    'BEGIN','SELECT','INSERT','COMMIT'
  ]);
  assert.deepEqual(queries[1].params,['local:ci-analyst',proposal]);
  assert.deepEqual(queries[2].params.slice(0,6),[
    reviewId,'local:ci-analyst',proposal,2,'business','FR'
  ]);
  assert.ok(queries.every(x=>!/\bUPDATE\b|\bDELETE\b/.test(x.sql)));
  assert.equal(releases,1);
});
test('foreign workspace, revised quote and malformed evidence fail before insert',async()=>{
  for(const mode of ['foreign','stale']){
    const queries=[];let released=0;
    const db={connect:async()=>({
      query:async(sql)=>{
        queries.push(sql);
        if(sql.startsWith('SELECT revision')){
          return {rows:mode==='foreign'?[]:[{revision:3}]};
        }
        return {rows:[]};
      },release:()=>{released++;}
    })};
    await assert.rejects(()=>recordTaxReview(db,valid,'ci-analyst'),
      /not found|changed/);
    assert.equal(queries.at(-1),'ROLLBACK');
    assert.equal(queries.some(x=>x.startsWith('INSERT')),false);
    assert.equal(released,1);
  }
});
test('bounded research history never infers a buyer country without evidence',async()=>{
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('SELECT id,revision'))
      return {rows:[{id:proposal,revision:2}]};
    return {rows:Array.from({length:21},(_,i)=>({
      id:'review-'+i,buyer_type:'unknown',buyer_country:null
    }))};
  }};
  const result=await getTaxReviews(db,proposal,'ci-analyst');
  assert.equal(result.more,true);
  assert.equal(result.items.length,20);
  assert.equal(result.proposal_revision,2);
  assert.deepEqual(queries.map(q=>q.params),[
    ['local:ci-analyst',proposal],['local:ci-analyst',proposal]
  ]);
  assert.match(queries[1].sql,/LIMIT 21/);
  await assert.rejects(()=>getTaxReviews({
    query:async()=>({rows:[]})
  },proposal,'ci-analyst'),/not found/);
});

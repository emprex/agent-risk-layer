import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const page = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'site/request.js'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'site/privacy.html'), 'utf8');

const sample = {
  name: 'Synthetic Reviewer',
  company: 'Synthetic Organisation',
  email: 'nobody@example.invalid',
  systemName: 'Synthetic Agent',
  useCase: 'Synthetic-only process',
  access: 'No real data or credentials',
  concern: 'Owner-approved staging assessment'
};

function harness({ action='https://formspree.io/f/example', valid=true, fetcher }={}) {
  let listener;
  let resetCount=0;
  const calls=[];
  const button={disabled:false,textContent:'Send assessment request'};
  const status={textContent:''};
  class MockFormData {
    constructor(form) {
      assert.equal(form, mockForm);
      this.values=new Map(Object.entries(sample));
    }
    get(key) { return this.values.get(key); }
    set(key,value) { this.values.set(key,value); }
  }
  const mockForm={
    action,
    reportValidity(){return valid;},
    querySelector(selector){
      assert.equal(selector,'button[type="submit"]');
      return button;
    },
    reset(){resetCount++},
    addEventListener(type,callback){
      assert.equal(type,'submit');
      listener=callback;
    }
  };
  const sandbox={
    document:{querySelector(selector){
      return selector==='#requestForm'?mockForm:
        selector==='#formStatus'?status:null;
    }},
    FormData:MockFormData,
    URL,
    fetch:async (url,options)=>{
      calls.push({url,options});
      return fetcher ? fetcher(url,options) : {ok:true};
    }
  };
  vm.runInNewContext(script,sandbox,{filename:'site/request.js',timeout:1000});
  assert.equal(typeof listener,'function');
  return {
    calls,button,status,
    get resetCount(){return resetCount;},
    submit(){
      let prevented=false;
      const finished=listener({preventDefault(){prevented=true;}});
      assert.equal(prevented,true);
      return finished;
    }
  };
}

test('published static page has an explicitly HTTPS Formspree request path and privacy fallback',()=>{
  const form=page.match(/<form\b[^>]*id="requestForm"[^>]*>/)?.[0];
  assert.ok(form);
  assert.match(form,/action="https:\/\/formspree\.io\/f\/[A-Za-z0-9]+"/);
  assert.match(form,/method="POST"/i);
  assert.match(page,/<script src="\/request\.js" defer><\/script>/);
  assert.match(page,/id="formStatus" role="status" aria-live="polite"/);
  assert.match(page,/href="\/privacy\.html"/);
  assert.match(privacy,/Formspree/);
  assert.match(page,/No secrets through this site/);
  assert.match(page,/Do not include passwords, API keys, access tokens, private keys or customer data/);
  assert.doesNotMatch(page,/\/api\/assessment-request|checkout|stripe/i);
  assert.doesNotMatch(script,/\/api\/assessment-request/);
  for(const name of ['name','company','email','systemName','useCase','access','concern']){
    assert.match(page,new RegExp('name="'+name+'"'));
  }
});

test('client-side accepted response is not labelled as verified inbox delivery', async()=>{
  const ui=harness();
  await ui.submit();
  assert.equal(ui.calls.length,1);
  const call=ui.calls[0];
  assert.equal(call.url,'https://formspree.io/f/example');
  assert.equal(call.options.method,'POST');
  assert.equal(call.options.headers.Accept,'application/json');
  assert.equal(call.options.body.get('_subject'),'Assessment request — Synthetic Organisation');
  assert.equal(call.options.body.get('email'),sample.email);
  assert.equal(ui.resetCount,1);
  assert.match(ui.status.textContent,/accepted by the form service/i);
  assert.doesNotMatch(ui.status.textContent,/delivered to.*inbox|verified.*receipt/i);
  assert.equal(ui.button.disabled,false);
  assert.equal(ui.button.textContent,'Send assessment request');
});

test('duplicate submit is blocked while a request is pending',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const ui=harness({fetcher:()=>pending});
  const first=ui.submit();
  const duplicate=ui.submit();
  assert.equal(ui.calls.length,1);
  assert.equal(ui.button.disabled,true);
  assert.match(ui.status.textContent,/Sending/);
  await duplicate;
  release({ok:true});
  await first;
  assert.equal(ui.calls.length,1);
  assert.equal(ui.resetCount,1);
  assert.equal(ui.button.disabled,false);
});

test('invalid form and unexpected destination fail before a cross-origin submission',async()=>{
  const invalid=harness({valid:false});
  await invalid.submit();
  assert.equal(invalid.calls.length,0);
  assert.equal(invalid.resetCount,0);
  const hijacked=harness({action:'https://example.invalid/f/xjygkpwz'});
  await hijacked.submit();
  assert.equal(hijacked.calls.length,0);
  assert.equal(hijacked.resetCount,0);
  assert.match(hijacked.status.textContent,/could not be confirmed/i);
  assert.equal(hijacked.button.disabled,false);
});

test('provider errors and network failures allow retry without claiming success',async()=>{
  let attempts=0;
  const ui=harness({fetcher:()=>{
    attempts++;
    if (attempts===1) return {ok:false};
    if (attempts===2) throw new Error('simulated network outage');
    return {ok:true};
  }});
  await ui.submit();
  assert.match(ui.status.textContent,/could not be confirmed/);
  assert.equal(ui.resetCount,0);
  assert.equal(ui.button.disabled,false);
  await ui.submit();
  assert.match(ui.status.textContent,/could not be confirmed/);
  assert.equal(ui.resetCount,0);
  assert.equal(ui.button.disabled,false);
  await ui.submit();
  assert.equal(ui.resetCount,1);
  assert.equal(ui.calls.length,3);
  assert.match(ui.status.textContent,/accepted by the form service/);
});

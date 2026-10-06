const form=document.querySelector('#requestForm');
const status=document.querySelector('#formStatus');

form?.addEventListener('submit',async(event)=>{
  event.preventDefault();

  const button=form.querySelector('button[type="submit"]');
  const data=new FormData(form);
  const company=String(data.get('company')||'').trim();
  const systemName=String(data.get('systemName')||'').trim();

  data.set('_subject',`Assessment request — ${company||systemName||'AgentRiskLayer'}`);

  if(button) button.disabled=true;
  status.textContent='Sending assessment request…';

  try{
    const response=await fetch(form.action,{
      method:'POST',
      body:data,
      headers:{Accept:'application/json'}
    });

    if(!response.ok) throw new Error('Request failed');

    form.reset();
    status.textContent='Assessment request sent. AgentRiskLayer will review the scope and reply by email.';
  }catch{
    status.textContent='The request could not be sent. Please try again or email support@agentrisklayer.com.';
  }finally{
    if(button) button.disabled=false;
  }
});

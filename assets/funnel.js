// Enquiry funnel card. Used by the homepage and /where-it-hurts.
(function(){
  var card=document.getElementById('funnel'); if(!card) return;
  var steps=card.querySelectorAll('.fn-step'), bars=card.querySelectorAll('.fn-bar i');
  var top=document.getElementById('fnTop'), back=document.getElementById('fnBack'), count=document.getElementById('fnCount');
  var form=document.getElementById('fnForm'), err=document.getElementById('fnErr'), submit=document.getElementById('fnSubmit');
  var state={need:'',goal:''}, labels={}, current=1;

  function go(n,focus){
    current=n;
    steps.forEach(function(s){s.classList.toggle('is-active',+s.dataset.step===n);});
    bars.forEach(function(b,i){b.classList.toggle('on',i<Math.min(n,3));});
    top.style.visibility=n===4?'hidden':'visible';
    back.hidden=n===1||n===4;
    count.textContent='Step '+Math.min(n,3)+' of 3';
    if(focus!==false){var q=card.querySelector('.fn-step.is-active .fn-q'); if(q) q.focus({preventScroll:true});}
  }

  card.querySelectorAll('.fn-tile').forEach(function(t){
    t.addEventListener('click',function(){
      var f=t.dataset.field;
      state[f]=t.dataset.value; labels[f]=t.querySelector('strong').textContent;
      t.parentNode.querySelectorAll('.fn-tile').forEach(function(x){x.classList.toggle('is-picked',x===t);});
      setTimeout(function(){go(current+1);},220);
    });
  });
  back.addEventListener('click',function(){go(current-1);});

  form.addEventListener('submit',function(e){
    e.preventDefault(); err.textContent='';
    var d={need:state.need,goal:state.goal,name:form.name.value.trim(),email:form.email.value.trim(),business:form.business.value.trim(),website:form.website.value};
    if(!d.name||!d.business||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)){err.textContent='Please add your name, a valid email and your business name.';return;}
    if(!d.need||!d.goal){go(1);return;}
    submit.disabled=true; submit.textContent='Sending...';
    fetch('/api/enquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){if(!r.ok) throw new Error(r.status); return r.json();})
      .then(function(){
        try{sessionStorage.setItem('vl_lead',JSON.stringify({first:d.name.split(/\s+/)[0],need:d.need,goal:d.goal,business:d.business}));}catch(e){}
        window.location.href='/thanks';
      })
      .catch(function(){err.innerHTML='That didn&rsquo;t send. Please try again, or email <a href="mailto:james@veruslink.au">james@veruslink.au</a>.';})
      .then(function(){submit.disabled=false; submit.innerHTML='Send it to James &rarr;';});
  });

  document.getElementById('fnRestart').addEventListener('click',function(){
    state={need:'',goal:''}; labels={}; form.reset(); err.textContent='';
    card.querySelectorAll('.fn-tile.is-picked').forEach(function(x){x.classList.remove('is-picked');});
    go(1);
  });
})();

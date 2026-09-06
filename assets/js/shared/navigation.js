// Hash routes stay on the authenticated role page, including on reload.
export function createNavigation(render, beforeLeave=async()=>true) {
  let current;
  let chain=Promise.resolve();
  const read=()=>Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const url=route=>`${location.pathname}${location.search}#${new URLSearchParams(route)}`;
  const navigate=(route, replace=false, fromHistory=false)=>{
    chain=chain.catch(()=>{}).then(async()=>{
      if(!await beforeLeave()) { if(current)history.replaceState(null,'',url(current));return; }
      if(!fromHistory)history[replace?'replaceState':'pushState'](null,'',url(route));
      current=route;
      await render(route);
    });
    return chain;
  };
  window.addEventListener('popstate',()=>navigate(read(),false,true));
  return {navigate,start:()=>navigate(read(),true)};
}

import {useEffect,useState} from 'react';
import {api} from './api.js';
export function useCollectionTags(collection) {
  const scope=collection||'unfiled';
  const [state,setState]=useState({scope:null,tags:[]});
  useEffect(()=>{const controller=new AbortController();api('/api/tags?collection='+encodeURIComponent(scope),{signal:controller.signal}).then(tags=>setState({scope,tags})).catch(()=>{});return()=>controller.abort()},[scope]);
  return state.scope===scope?state.tags:[];
}

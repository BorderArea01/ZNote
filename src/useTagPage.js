import {useEffect,useState} from 'react';
import {api} from './api.js';

export function useTagPage(collection,{query='',offset=0,limit=40,revision=0,cursor,enabled=true}={}) {
  const scope=collection||'unfiled',key=JSON.stringify([scope,query.trim(),offset,limit,revision,cursor,enabled]);
  const [state,setState]=useState({});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      const params=new URLSearchParams({collection:scope,q:query.trim(),offset,limit});
      if(cursor!==undefined)params.set('cursor',cursor);
      try {const result=await api('/api/tags?'+params,{signal:controller.signal});if(!controller.signal.aborted)setState({...result,key,loading:false,error:null});}
      catch(error){if(!controller.signal.aborted)setState({key,tags:[],total:0,loading:false,error});}
    },query.trim()?180:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key]);
  return enabled&&state.key===key?state:{tags:[],total:0,loading:enabled,error:null};
}

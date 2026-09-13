import {useTagPage} from './useTagPage.js';
export function useCollectionTags(collection,query='') {
  return useTagPage(collection,{query,limit:40}).tags;
}

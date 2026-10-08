import {diffText} from './submission-diff.js';
self.onmessage=event=>{
  const {previous,current}=event.data;
  try {self.postMessage({result:diffText(previous,current)});}
  catch {self.postMessage({error:'comparison_failed'});}
};

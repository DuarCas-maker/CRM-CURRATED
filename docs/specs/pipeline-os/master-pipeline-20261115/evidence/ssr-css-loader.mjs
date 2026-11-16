import {registerHooks} from 'node:module';
// SSR-only QA: styles are checked by the actual Next build and browser, not executed by Node.
registerHooks({load(url,context,next){
  return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);
}});

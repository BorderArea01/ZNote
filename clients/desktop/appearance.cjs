const styles=new Set(['minimal','glass','cyber','paper','glitch']);
const modes=new Set(['light','dark','system']);
const palettes=new Set(['forest','ocean','violet','rose','amber','slate']);
function normalize(value){
 if(!value||!styles.has(value.style)||!modes.has(value.mode))return null;
 return {style:value.style,mode:value.mode,palette:palettes.has(value.palette)?value.palette:'forest',motion:value.motion==='still'?'still':'dynamic'};
}
module.exports={normalize};

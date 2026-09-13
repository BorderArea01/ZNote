const {isIP}=require('node:net');
function normalizeAddress(input) {
  const value=String(input||'').trim();
  let url;try{url=new URL(value.includes('://')?value:'http://'+value);}catch{throw Error('请输入完整的知识库地址，例如 http://192.168.1.10:3741');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('请填写知识库根地址，不要包含密码、路径或查询参数');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  const ipv4=isIP(host)===4;
  const local=host==='localhost'||host==='::1'||(ipv4&&(/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)))||/^(fc|fd)[a-f0-9]{2}:/i.test(host)||/^fe[89ab][a-f0-9]:/i.test(host)||/\.(local|lan|home\.arpa)$/.test(host)||(!host.includes('.')&&!host.includes(':'));
  if(url.protocol==='http:'&&!local)throw Error('公网知识库请使用 HTTPS；HTTP 仅用于本机和局域网');
  return url.origin;
}
function sameOrigin(value,origin){try{return new URL(value).origin===origin}catch{return false}}
function externalLink(value){try{const url=new URL(value);return ['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password}catch{return false}}
module.exports={normalizeAddress,sameOrigin,externalLink};

import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedSite,parseBlockedSites,siteRuleFor,siteControlState,toggleSiteBlock} from '../addons/browser/clipper/site-policy.js';
import {mediaDescription} from '../shared/media-description.js';
test('blacklist uses host boundaries and exact origins without blocking other LAN services',()=>{
 const config={server:'http://localhost:3741',blockedSites:parseBlockedSites('example.com\nhttps://127.0.0.1:8000\n*.blocked.test')};
 for(const url of ['http://localhost:3741/path','https://example.com','https://sub.example.com/a','http://blocked.test','https://127.0.0.1:8000/a'])assert.equal(blockedSite(url,config),true,url);
 for(const url of ['http://localhost:9000','https://example.com.evil.test','https://notexample.com','http://127.0.0.1:8000','https://127.0.0.1:8001'])assert.equal(blockedSite(url,config),false,url);
 assert.throws(()=>parseBlockedSites('https://example.com/private'));assert.throws(()=>parseBlockedSites('https://user:password@example.com'));
});
test('current-site toggle adds and removes only its direct rule, preserves broader rules and scopes custom ports',()=>{
 const config={server:'http://localhost:3741',blockedSites:[]};
 assert.equal(siteRuleFor('https://www.example.com/gallery/1?share=1'),'www.example.com');
 assert.equal(siteRuleFor('http://127.0.0.1:5173/page'),'http://127.0.0.1:5173');
 let state=toggleSiteBlock('https://www.example.com/gallery/1',config);
 assert.equal(state.blocked,true);assert.deepEqual(state.blockedSites,['www.example.com']);
 assert.equal(blockedSite('https://img.www.example.com/a.png',{blockedSites:state.blockedSites}),true);
 state=toggleSiteBlock('https://www.example.com/gallery/1',{...config,blockedSites:state.blockedSites});
 assert.equal(state.blocked,false);assert.deepEqual(state.blockedSites,[]);
 state=toggleSiteBlock('http://127.0.0.1:5173/page',config);
 assert.equal(blockedSite('http://127.0.0.1:5173/other',{blockedSites:state.blockedSites}),true);
 assert.equal(blockedSite('http://127.0.0.1:5174/other',{blockedSites:state.blockedSites}),false);
 const broad={...config,blockedSites:['example.com']};
 const inherited=siteControlState('https://sub.example.com/page',broad);
 assert.equal(inherited.blocked,true);assert.equal(inherited.direct.length,0);
 const unchanged=toggleSiteBlock('https://sub.example.com/page',broad);
 assert.equal(unchanged.changed,false);assert.deepEqual(unchanged.blockedSites,['example.com']);
 const automatic=toggleSiteBlock('http://localhost:3741/settings',config);
 assert.equal(automatic.automatic,true);assert.equal(automatic.changed,false);
 assert.equal(siteControlState('chrome://extensions',config).supported,false);
});
test('media descriptions preserve user Markdown while suppressing generated technical metadata',()=>{
 const content='作者：[作者](https://www.pixiv.net/users/1)\n\n**说明**\n\n[参考](https://example.com)\n\n原文件：https://i.pximg.net/a.png\n\n来源链接：https://www.pixiv.net/artworks/1\n\n页码：1 / 2';
 assert.equal(mediaDescription(content),'作者：[作者](https://www.pixiv.net/users/1)\n\n**说明**\n\n[参考](https://example.com)');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedSite,parseBlockedSites} from '../extensions/clipper/site-policy.js';
import {mediaDescription} from '../shared/media-description.js';
test('blacklist uses host boundaries and exact origins without blocking other LAN services',()=>{
 const config={server:'http://localhost:3741',blockedSites:parseBlockedSites('example.com\nhttps://127.0.0.1:8000\n*.blocked.test')};
 for(const url of ['http://localhost:3741/path','https://example.com','https://sub.example.com/a','http://blocked.test','https://127.0.0.1:8000/a'])assert.equal(blockedSite(url,config),true,url);
 for(const url of ['http://localhost:9000','https://example.com.evil.test','https://notexample.com','http://127.0.0.1:8000','https://127.0.0.1:8001'])assert.equal(blockedSite(url,config),false,url);
 assert.throws(()=>parseBlockedSites('https://example.com/private'));assert.throws(()=>parseBlockedSites('https://user:password@example.com'));
});
test('media descriptions preserve user Markdown while suppressing generated technical metadata',()=>{
 const content='作者：[作者](https://www.pixiv.net/users/1)\n\n**说明**\n\n[参考](https://example.com)\n\n原文件：https://i.pximg.net/a.png\n\n来源链接：https://www.pixiv.net/artworks/1\n\n页码：1 / 2';
 assert.equal(mediaDescription(content),'作者：[作者](https://www.pixiv.net/users/1)\n\n**说明**\n\n[参考](https://example.com)');
});

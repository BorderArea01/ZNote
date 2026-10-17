import test from 'node:test';
import assert from 'node:assert/strict';
import {createProxyResolver,windowsProxyServer} from '../server/network-proxy.js';

test('system proxy changes, including disabled-to-enabled, expire without a service restart',()=>{
  let time=0,value='',reads=0;const resolver=createProxyResolver({env:{},readSystem:()=>{reads++;return value;},now:()=>time,ttlMs:1000});
  assert.equal(resolver.url(),'');value='http://127.0.0.1:7897';time=999;assert.equal(resolver.url(),'');assert.equal(reads,1);
  time=1000;assert.equal(resolver.url(),value);assert.equal(reads,2);
  value='http://127.0.0.1:7899';time=2000;assert.equal(resolver.url(),value);
  value='';time=3000;assert.equal(resolver.url(),'');
});
test('a failed connection can refresh a cached direct route immediately',()=>{
  let value='';const resolver=createProxyResolver({env:{},readSystem:()=>value});assert.equal(resolver.url(),'');
  value='http://127.0.0.1:7897';resolver.reset();assert.equal(resolver.url(),value);
});
test('explicit proxy environment wins, is live, and clearing it returns to the system proxy',()=>{
  const env={HTTPS_PROXY:'http://env:8080'},resolver=createProxyResolver({env,readSystem:()=> 'http://system:7897'});
  assert.equal(resolver.url(),env.HTTPS_PROXY);env.ZNOTE_HTTP_PROXY='http://explicit:7899';assert.equal(resolver.url(),env.ZNOTE_HTTP_PROXY);
  env.ZNOTE_HTTP_PROXY=' ';assert.equal(resolver.url(),env.HTTPS_PROXY);env.HTTPS_PROXY='';assert.equal(resolver.url(),'http://system:7897');
});
test('WinINet protocol mappings prefer HTTPS regardless of entry order',()=>{
  assert.equal(windowsProxyServer('http=127.0.0.1:7897;https=127.0.0.1:7899'),'http://127.0.0.1:7899');
  assert.equal(windowsProxyServer('https=https://proxy.example:8443;http=proxy.example:8080'),'https://proxy.example:8443');
  assert.equal(windowsProxyServer('127.0.0.1:7897'),'http://127.0.0.1:7897');assert.equal(windowsProxyServer('direct'),'');assert.equal(windowsProxyServer('socks=127.0.0.1:1080'),'');
});

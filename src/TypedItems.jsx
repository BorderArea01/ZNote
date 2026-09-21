import React from 'react';
import {VirtualItems} from './VirtualItems.jsx';
import {isMediaGroup} from './media-group.js';
import './typed-items.css';

export const cardType=item=>isMediaGroup(item)?'group':item.kind;
const names={image:'单张图片',group:'图片组',note:'图文笔记',video:'视频'};

// Keep real section boundaries in the presentation as well as the API ordering.
// Each section retains the existing bounded rendering and folded group cards.
export function TypedItems({grouped,order,items,children,...props}){
  if(!grouped)return <VirtualItems {...props} items={items}>{children}</VirtualItems>;
  const buckets=new Map(order.split(',').map(type=>[type,[]]));
  for(const item of items)buckets.get(cardType(item))?.push(item);
  return <div className="typed-items">{[...buckets].filter(([,rows])=>rows.length).map(([type,rows])=><section className="item-type-section" data-item-type={type} aria-label={names[type]} key={type}>
    <h2 className="item-type-heading">{names[type]}</h2>
    <VirtualItems {...props} items={rows}>{children}</VirtualItems>
  </section>)}</div>;
}

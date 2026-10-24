import React,{useState} from 'react';
import * as Primitive from '@radix-ui/react-select';
import {Check,ChevronDown,ChevronUp} from 'lucide-react';
import {useAppBack} from './back-navigation.js';
import './select.css';

export function Select({value,onChange,options,label,placeholder='请选择',disabled=false,required=false,id,className=''}) {
  const [open,setOpen]=useState(false);
  useAppBack(()=>setOpen(false),open,400);
  return <Primitive.Root value={value||''} onValueChange={onChange} open={open} onOpenChange={setOpen} disabled={disabled} required={required}>
    <Primitive.Trigger id={id} aria-label={label} className={'zn-select-trigger '+className}>
      <Primitive.Value placeholder={placeholder}/><Primitive.Icon><ChevronDown size={15}/></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal><Primitive.Content position="popper" sideOffset={6} collisionPadding={12} className="zn-select-menu">
      <Primitive.ScrollUpButton className="zn-select-scroll"><ChevronUp size={14}/></Primitive.ScrollUpButton>
      <Primitive.Viewport className="zn-select-options">{options.map(option=><Primitive.Item key={option.value} value={option.value} disabled={option.disabled} className="zn-select-option">
        <Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator><Check size={15}/></Primitive.ItemIndicator>
      </Primitive.Item>)}</Primitive.Viewport>
      <Primitive.ScrollDownButton className="zn-select-scroll"><ChevronDown size={14}/></Primitive.ScrollDownButton>
    </Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}

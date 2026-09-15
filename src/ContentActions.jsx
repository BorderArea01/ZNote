import React,{useState} from 'react';
import {Plus} from 'lucide-react';
import {Dialog} from './ui.jsx';
import './content-actions.css';
export function ContentActions({children}){
  const [open,setOpen]=useState(false);
  return <><div className="heading-actions">
    <div className="desktop-content-actions">{children}</div>
    <button className="mobile-content-actions primary" aria-haspopup="dialog" onClick={()=>setOpen(true)}><Plus size={18}/>添加</button>
    </div>{open&&<Dialog title="内容操作" className="content-actions-dialog" onClose={()=>setOpen(false)}>
      <div className="content-actions-list">{React.Children.map(children,child=>React.isValidElement(child)?React.cloneElement(child,{className:'',onClick:event=>{setOpen(false);child.props.onClick?.(event);}}):child)}</div>
    </Dialog>}
  </>;
}

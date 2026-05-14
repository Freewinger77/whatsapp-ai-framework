import { createContext, useContext, useState, ReactNode } from "react";

type SidebarCtx = { collapsed: boolean; toggle: () => void };
const Ctx = createContext<SidebarCtx>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Ctx.Provider value={{ collapsed, toggle: () => setCollapsed((c) => !c) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSidebar = () => useContext(Ctx);

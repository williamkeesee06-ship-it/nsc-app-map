import { useState, useEffect } from "react";

export type ContractId = "Lumen" | "Ziply";

let activeContract: ContractId = (localStorage.getItem("nsc.activeContract") as ContractId) ?? "Lumen";
const listeners = new Set<(contract: ContractId) => void>();

export function getActiveContract(): ContractId {
  return activeContract;
}

export function setActiveContract(contract: ContractId) {
  if (activeContract === contract) return;
  activeContract = contract;
  localStorage.setItem("nsc.activeContract", contract);
  listeners.forEach((l) => l(contract));
  // Broadcast reload events so widgets and list reload
  window.dispatchEvent(new CustomEvent("nsc:contract-changed", { detail: { contract } }));
  window.dispatchEvent(new CustomEvent("nsc:jobs-reload"));
}

export function useActiveContract() {
  const [contract, setContract] = useState<ContractId>(activeContract);
  useEffect(() => {
    const handler = (next: ContractId) => setContract(next);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);
  return { contract, setActiveContract };
}

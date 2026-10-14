// Permission parity does not change the user's identity or audit role.
export function isInventoryPicRole(role){
 const normalized=String(role??'').normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g,' ');
 return ['pic inventory','inventory pic','picinventory','inventorypic'].includes(normalized);
}

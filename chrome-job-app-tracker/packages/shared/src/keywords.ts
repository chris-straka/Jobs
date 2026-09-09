const STOPWORDS = new Set(
  "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,have,has,had,do,does,did,will,would,can,could,should,shall,may,might,must,you,your,we,our,they,their,he,she,it,its,this,that,these,those,there,here,what,which,who,whom,whose,when,where,why,how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,into,out,over,under,again,once,per,via,etc,eg,ie,also,across,within,without,between,through,during,including,includes,include,using,use,used,both,join,joining,looking,seeking,help,helps,work,working,team,year,years,plus,strong,ability,able,day,role,new,will".split(
    ",",
  ),
);

/** Lowercase alphanumeric tokens, stopwords and noise dropped. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((t) => t.replace(/^[+#]+|[+#]+$/g, ""))
    .filter((t) => t.length >= 2 && !/^[0-9]+$/.test(t) && !STOPWORDS.has(t));
}

/** Token → occurrences, most frequent first. */
export function frequencies(text: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

import { isSameOriginRequest } from "@/lib/origin";
import { extractInvoice, invoiceImageLimit } from "@/lib/invoice-extraction";
import { UserInputError } from "@/lib/errors";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=45;
export async function POST(request:Request) {
  if(!isSameOriginRequest(request)) return Response.json({error:"Only same-origin requests are allowed."},{status:403});
  if(Number(request.headers.get("content-length"))>invoiceImageLimit+65536) return Response.json({error:"Use an invoice image smaller than 3 MB."},{status:413});
  try {
    // Bound multipart data before parsing; File.size alone is too late for chunked requests.
    if(!request.body) return Response.json({error:"Choose an invoice image."},{status:400});
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];
    let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>invoiceImageLimit+65536){await reader.cancel();return Response.json({error:"Use an invoice image smaller than 3 MB."},{status:413});}chunks.push(value);}
    const form=await new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const file=form.get("file");
    if(!(file instanceof File)) return Response.json({error:"Choose an invoice image."},{status:400});
    return Response.json(await extractInvoice(new Uint8Array(await file.arrayBuffer())));
  } catch(error) {
    if(error instanceof UserInputError) return Response.json({error:error.message,code:error.code},{status:error.status});
    return Response.json({error:"Could not read this invoice photo. Use PNG, JPEG, or WebP and retry."},{status:400});
  }
}

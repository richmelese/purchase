import InvoiceView from '@/components/InvoiceView';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceView kind="S" id={id} />;
}

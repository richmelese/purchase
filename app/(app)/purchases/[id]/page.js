import InvoiceView from '@/components/InvoiceView';

export default async function Page({ params }) {
  const { id } = await params;
  return <InvoiceView kind="P" id={id} />;
}

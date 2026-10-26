import InvoiceForm from '@/components/InvoiceForm';

export default async function Page({ params }) {
  const { id } = await params;
  return <InvoiceForm kind="S" id={id} />;
}

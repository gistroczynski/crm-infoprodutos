function Bone({ w }: { w: string }) {
  return <div className={`h-3 bg-gray-200 rounded-full animate-pulse ${w}`} />
}

export default function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-3">
        <div className="space-y-2">
          <Bone w="w-32" />
          <Bone w="w-44" />
        </div>
      </td>
      <td className="px-4 py-3"><Bone w="w-36" /></td>
      <td className="px-4 py-3"><Bone w="w-16" /></td>
      <td className="px-4 py-3"><Bone w="w-16" /></td>
      <td className="px-4 py-3"><Bone w="w-14" /></td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <Bone w="w-24" />
          <Bone w="w-8" />
        </div>
      </td>
    </tr>
  )
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // React StrictMode intentionally double-invokes effects in DEVELOPMENT to help
  // surface side-effect bugs. With our data-fetching effects that means every
  // GET/POST fires twice in the dev server log (and starting an interview created
  // two sessions). It never happens in a production build. We disable it so dev
  // traffic matches production 1:1 and interview/enroll effects run exactly once.
  reactStrictMode: false,
};

export default nextConfig;

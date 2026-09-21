import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useState } from "react";

const stats = [
  { value: 1, suffix: "", label: "Inventory ledger" },
  { value: 409, suffix: "", label: "On short stock" },
  { value: 4, suffix: "", label: "Classic WMS loops" },
  { value: 0, suffix: "", label: "Extra scanner apps" },
];

export function LandingStats() {
  const [animate, setAnimate] = useState(false);

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <motion.div
          className="grid grid-cols-2 gap-8 md:grid-cols-4"
          onViewportEnter={() => setAnimate(true)}
          viewport={{ once: true, amount: 0.4 }}
        >
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.6,
                delay: index * 0.1,
                ease: "easeOut",
              }}
              className="text-center"
            >
              <div className="mb-2 text-3xl font-bold md:text-4xl">
                <NumberFlow
                  value={animate ? stat.value : 0}
                  format={{
                    maximumFractionDigits: stat.value % 1 === 0 ? 0 : 1,
                  }}
                />
                {stat.suffix}
              </div>
              <div className="text-sm font-medium text-muted-foreground">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

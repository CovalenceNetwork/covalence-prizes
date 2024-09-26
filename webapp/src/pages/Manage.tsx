// src/pages/ManagePrizePage.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { ContractFunctionExecutionError, formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { config } from "../config";
import { AllocationStrategy, PrizeDetails, State } from "../lib/types";
import { useAppContext } from "../contexts/AppContext";
import { Link, useParams } from "react-router-dom";
import ProgressBar from "../components/ProgressBar";
import ManagementCard from "../components/ManagementCard";
import StatusItem from "../components/StatusItem";
import React from "react";

const getStrategyName = (strategy: AllocationStrategy): string => {
  return config.allocationStrategies[strategy].label;
};

const ManagePrizePage: React.FC = () => {
  const { prizeId } = useParams<{ prizeId: string }>();
  const { prizeDiamond, isPrizesLoading } = useAppContext();
  const { address } = useAccount();

  const parsedPrizeId = useMemo(() => (prizeId ? BigInt(prizeId) : undefined), [prizeId]);

  const [prize, setPrize] = useState<PrizeDetails | null>(null);
  const [weights, setWeights] = useState<number[]>([]);
  const [evaluators, setEvaluators] = useState<string>("");
  const [fundAmount, setFundAmount] = useState<string>("0.0001");
  const [isOrganizer, setIsOrganizer] = useState<boolean>(false);
  const [isOrganizerLoaded, setIsOrganizerLoaded] = useState<boolean>(false);
  const [isFunded, setIsFunded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentEvaluators, setCurrentEvaluators] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<number>(10);
  const [allocationInProgress, setAllocationInProgress] = useState<boolean>(false);
  const [allocationDetails, setAllocationDetails] = useState<{
    lastProcessedIndex: bigint;
    contributionCount: bigint;
    rewardsAllocated: boolean;
  } | null>(null);

  const fetchPrizeDetails = useCallback(async () => {
    if (!parsedPrizeId || !address) return;

    console.log("Fetching prize details for prizeId:", parsedPrizeId.toString());
    try {
      const fetchedPrize = await prizeDiamond.getPrizeDetails(parsedPrizeId);
      const weights = await prizeDiamond.getCriteriaWeights(parsedPrizeId);
      const isOrganizerCheck = await prizeDiamond.isPrizeOrganizer(parsedPrizeId, address);
      const evaluatorsList = await prizeDiamond.getPrizeEvaluators(parsedPrizeId);
      const allocDetails = await prizeDiamond.getAllocationDetails(parsedPrizeId);

      console.log("Fetched prize details:", fetchedPrize);
      console.log("Fetched weights:", weights);
      console.log("Is organizer:", isOrganizerCheck);
      console.log("Evaluators list:", evaluatorsList);
      console.log("Allocation details:", allocDetails);

      setPrize(fetchedPrize);
      setWeights(weights);
      setIsOrganizer(isOrganizerCheck);
      setIsOrganizerLoaded(true);
      setCurrentEvaluators(evaluatorsList);
      setAllocationDetails(allocDetails);

      const remainingContributions = fetchedPrize.contributionCount - fetchedPrize.lastProcessedIndex;
      setBatchSize(Number(remainingContributions >= 10n ? 10n : remainingContributions));
    } catch (error) {
      console.error("Error fetching prize details:", error);
      setError("Failed to fetch prize details. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  }, [parsedPrizeId, address, prizeDiamond]);

  useEffect(() => {
    console.log("Effect triggered. parsedPrizeId:", parsedPrizeId?.toString(), "isPrizesLoading:", isPrizesLoading);
    if (parsedPrizeId && !isPrizesLoading) {
      console.log("Calling fetchPrizeDetails");
      fetchPrizeDetails();
    }
  }, [parsedPrizeId, isPrizesLoading, fetchPrizeDetails]);

  useEffect(() => {
    console.log("isOrganizer:", isOrganizer);
    console.log("prize:", prize);
    console.log("address:", address);
  }, [isOrganizer, prize, address]);

  useEffect(() => {
    console.log("Current state:", {
      prize,
      weights,
      isOrganizer,
      isOrganizerLoaded,
      isFunded,
      isLoading,
      error,
    });
  }, [prize, weights, isOrganizer, isOrganizerLoaded, isFunded, isLoading, error]);

  useEffect(() => {
    console.log("Debug: Prize ID:", parsedPrizeId?.toString());
    console.log("Debug: Is Organizer:", isOrganizer);
    console.log("Debug: Current User Address:", address);
    console.log("Debug: Prize Organizer:", prize?.organizer);
  }, [parsedPrizeId, isOrganizer, address, prize]);

  const handleWeightChange = useCallback((index: number, value: string) => {
    setWeights((prevWeights) => {
      const newWeights = [...prevWeights];
      newWeights[index] = parseInt(value, 10);
      return newWeights;
    });
  }, []);

  const handleAssignWeights = useCallback(async () => {
    try {
      if (!parsedPrizeId) {
        toast.error("Invalid Prize ID");
        return;
      }

      const loadingToast = toast.loading("Assigning criteria weights...");

      await prizeDiamond.assignCriteriaWeightsAsync({
        prizeId: parsedPrizeId!,
        weights,
      });

      toast.dismiss(loadingToast);
      toast.success("Criteria weights assigned successfully");
      await fetchPrizeDetails();
    } catch (error) {
      console.error("Error assigning weights:", error);
      toast.error("Failed to assign weights");
    }
  }, [parsedPrizeId, weights, prizeDiamond, fetchPrizeDetails]);

  const handleFundPrize = useCallback(async () => {
    if (isFunded) {
      toast.error("Prize is already funded");
      return;
    }
    try {
      const amount = parseEther(fundAmount);
      const loadingToast = toast.loading("Funding prize...");

      await prizeDiamond.fundTotallyAsync({ prizeId: parsedPrizeId!, amount });

      toast.dismiss(loadingToast);
      toast.success("Prize funded successfully");
      await fetchPrizeDetails();
      setIsFunded(true);
    } catch (error) {
      console.error("Error funding prize:", error);
      toast.error("Failed to fund prize: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [prizeDiamond, fundAmount, parsedPrizeId, isFunded, fetchPrizeDetails]);

  const handleAddEvaluators = useCallback(async () => {
    try {
      if (prize?.state !== State.Setup && prize?.state !== State.Open) {
        toast.error("Evaluators can only be added during the Setup or Open state");
        return;
      }

      const evaluatorAddresses = evaluators.split(",").map((addr) => {
        const trimmed = addr.trim();
        if (!trimmed.startsWith("0x") || trimmed.length !== 42) {
          throw new Error(`Invalid Ethereum address: ${trimmed}`);
        }
        return trimmed as `0x${string}`;
      });

      const loadingToast = toast.loading("Adding evaluators...");

      await prizeDiamond.addEvaluatorsAsync({
        prizeId: parsedPrizeId!,
        evaluators: evaluatorAddresses,
      });

      toast.dismiss(loadingToast);
      toast.success("Evaluators added successfully");
      setEvaluators("");

      const updatedEvaluators = await prizeDiamond.getPrizeEvaluators(parsedPrizeId!);
      setCurrentEvaluators(updatedEvaluators);
    } catch (error) {
      console.error("Error adding evaluators:", error);
      toast.error("Failed to add evaluators: " + (error instanceof Error ? error.message : String(error)));
    }
  }, [prizeDiamond, evaluators, parsedPrizeId, prize?.state]);

  const canMoveToNextState = useCallback(() => {
    if (!prize) return false;

    switch (prize.state) {
      case State.Setup:
        return prize.fundedAmount >= prize.monetaryRewardPool && prize.strategy !== AllocationStrategy.Invalid;
      case State.Open:
        return prize.contributionCount > 0n;
      case State.Evaluating:
        console.log("Evaluated Contributions:", prize.evaluatedContributionsCount);
        console.log("Total Contributions:", Number(prize.contributionCount));
        return prize.evaluatedContributionsCount === Number(prize.contributionCount);
      case State.Allocating:
        return prize.rewardsAllocated;
      case State.Claiming:
        return prize.claimedRewardsCount === Number(prize.contributionCount);
      default:
        return false;
    }
  }, [prize]);

  const getNextStateRequirements = useCallback(() => {
    if (!prize) return "";

    switch (prize.state) {
      case State.Setup:
        return "Prize must be fully funded and have a valid allocation strategy.";
      case State.Open:
        return "At least one contribution is required.";
      case State.Evaluating:
        return "All contributions must be evaluated.";
      case State.Allocating:
        return "Rewards must be allocated.";
      case State.Claiming:
        return "All rewards must be claimed.";
      default:
        return "Cannot move to next state.";
    }
  }, [prize]);

  const handleMoveToNextState = useCallback(async () => {
    if (!canMoveToNextState()) {
      toast.error(getNextStateRequirements());
      return;
    }

    try {
      const loadingToast = toast.loading("Moving to next state...");

      await prizeDiamond.moveToNextStateAsync({ prizeId: parsedPrizeId! });

      toast.dismiss(loadingToast);
      toast.success("Moved to next state successfully");

      await fetchPrizeDetails();

      // Instead of navigating, we'll refresh the current page
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Error moving to next state:", error);
      if (error instanceof ContractFunctionExecutionError) {
        toast.error(`Failed to move to next state: ${error.message}`);
      } else {
        toast.error("Failed to move to next state");
      }
    }
  }, [canMoveToNextState, getNextStateRequirements, prizeDiamond, parsedPrizeId, fetchPrizeDetails]);

  const stateProgress = useMemo(() => {
    const states = [State.Setup, State.Open, State.Evaluating, State.Allocating, State.Claiming, State.Closed];
    return states.map((state) => ({
      state,
      active: prize?.state === state,
      completed: states.indexOf(state) < states.indexOf(prize?.state || State.Setup),
    }));
  }, [prize?.state]);

  useEffect(() => {
    if (prize) {
      setFundAmount(formatEther(prize.monetaryRewardPool));
      setIsFunded(prize.fundedAmount >= prize.monetaryRewardPool);
    }
  }, [prize]);

  const handleAllocateRewards = useCallback(async () => {
    if (!parsedPrizeId) {
      toast.error("Invalid Prize ID");
      return;
    }

    if (batchSize <= 0) {
      toast.error("Batch size must be greater than zero");
      return;
    }

    const remainingContributions = BigInt(prize?.contributionCount || 0n) - BigInt(prize?.lastProcessedIndex || 0n);

    if (BigInt(batchSize) > remainingContributions) {
      toast.error(`Batch size cannot exceed remaining contributions (${remainingContributions})`);
      return;
    }

    setAllocationInProgress(true);

    try {
      const result = await prizeDiamond.allocateRewardsBatchAsync({
        prizeId: parsedPrizeId,
        batchSize: BigInt(batchSize),
      });
      
      console.log("Allocation result:", result);
      toast.success(`Successfully allocated rewards for ${batchSize} contributions`);

      // Fetch only the updated allocation details
      const updatedDetails = await prizeDiamond.getAllocationDetails(parsedPrizeId);
      setAllocationDetails(updatedDetails);
    } catch (error: any) {
      console.error("Allocation error:", error);
      let errorMessage = "Failed to allocate rewards";
      if (error.message) {
        if (error.message.includes("execution aborted (timeout = 5s)")) {
          errorMessage += ": Operation timed out. Please try a smaller batch size.";
        } else {
          errorMessage += `: ${error.message}`;
        }
      }
      toast.error(errorMessage);
    } finally {
      setAllocationInProgress(false);
    }
  }, [prizeDiamond, batchSize, parsedPrizeId]);

  useEffect(() => {
    const fetchAllocationDetails = async () => {
      if (parsedPrizeId) {
        const details = await prizeDiamond.getAllocationDetails(parsedPrizeId);
        setAllocationDetails(details);
      }
    };

    fetchAllocationDetails();
  }, [parsedPrizeId, prizeDiamond]);

  const canAssignWeights = useMemo(() => {
    return prize?.state === State.Setup || prize?.state === State.Open;
  }, [prize?.state]);

  const canAllocateRewards = useMemo(() => {
    return prize?.state === State.Allocating && !allocationDetails?.rewardsAllocated;
  }, [prize?.state, allocationDetails?.rewardsAllocated]);

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen text-white text-2xl">Loading prize data...</div>;
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500 text-2xl">{error}</div>;
  }

  if (!prize && !isLoading) {
    return <div className="flex justify-center items-center h-screen text-white text-2xl">Prize not found</div>;
  }

  console.log("Allocation section conditions:", {
    isOrganizer,
    prizeState: prize?.state,
    rewardsAllocated: prize?.rewardsAllocated,
    allocationDetails: allocationDetails, // Log allocation details
  });

  if (!prize) {
    return <div className="flex justify-center items-center h-screen text-white text-2xl">Prize not found</div>;
  }

  console.log("Rendering prize data:", prize);

  return (
    <div className="container mx-auto px-4 py-8 bg-gradient-to-br from-primary-100 via-primary-300 to-primary-500 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center mb-8">
          <Link to={`/prize/${prizeId}`} className="text-primary-700 hover:text-primary-900 transition-colors duration-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex-grow text-center">
            <h2 className="text-2xl font-semibold text-primary-800 mb-2">Manage</h2>
            <h1 className="text-4xl sm:text-5xl font-bold text-primary-900 bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-secondary-600">
              {prize.name}
            </h1>
          </div>
        </div>

        {/* Unified ProgressBar with State Management */}
        <ProgressBar
          states={stateProgress}
          currentState={{
            state: prize.state,
            requirements: getNextStateRequirements(),
            canMoveToNext: canMoveToNextState(),
            handleMoveToNextState,
          }}
        />

        {/* Prize Details */}
        <ManagementCard title="Prize Details" className="mt-12 mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-white">
            <StatusItem label="Organizer" value={prize.organizer} />
            <StatusItem label="Created At" value={new Date(Number(prize.createdAt) * 1000).toLocaleDateString()} />
            <StatusItem label="Allocation Strategy" value={getStrategyName(prize.strategy)} />
            <StatusItem label="State" value={State[prize.state]} />
            <StatusItem label="Contributions" value={prize.contributionCount.toString()} />
            <StatusItem label="Evaluated Contributions" value={prize.evaluatedContributionsCount.toString()} />
          </div>
        </ManagementCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Fund Prize */}
          {isOrganizer && prize && (
            <ManagementCard title="Fund Prize">
              <div className="space-y-2 text-white">
                <StatusItem label="Required" value={`${formatEther(prize.monetaryRewardPool)} ETH`} />
                <StatusItem label="Current" value={`${formatEther(prize.fundedAmount)} ETH`} />
                <StatusItem
                  label="Status"
                  value={isFunded ? "Fully Funded" : "Not Fully Funded"}
                  status={isFunded ? "success" : "warning"}
                />
              </div>
              {!isFunded && (
                <div className="mt-4">
                  <label className="block mb-2 text-white">Fund Amount: {fundAmount} ETH</label>
                  <input
                    type="range"
                    min="0"
                    max={Number(formatEther(prize.monetaryRewardPool))}
                    step="0.0001"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="w-full h-2 bg-primary-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <button
                    onClick={handleFundPrize}
                    className="w-full mt-4 bg-accent-500 hover:bg-accent-600 text-white font-bold py-2 px-4 rounded transition duration-300"
                    disabled={isFunded}
                  >
                    {isFunded ? "Prize Fully Funded" : "Fund Prize"}
                  </button>
                </div>
              )}
            </ManagementCard>
          )}

          {/* Assign Criteria Weights */}
          <ManagementCard title="Assign Criteria Weights">
            {prize.criteriaNames.length > 1 ? (
              <>
                {prize.criteriaNames.map((name, index) => (
                  <div key={index} className="mb-4">
                    <label className="block mb-1 text-white">
                      {name}: {weights[index] || 0}
                    </label>
                    <input
                      type="range"
                      value={weights[index] || 0}
                      onChange={(e) => handleWeightChange(index, e.target.value)}
                      className="w-full h-2 bg-primary-200 rounded-lg appearance-none cursor-pointer"
                      min="0"
                      max="10"
                      step="1"
                      disabled={!canAssignWeights}
                    />
                  </div>
                ))}
              </>
            ) : (
              <p className="text-accent-300">Criteria weights cannot be changed when there is only one dimension.</p>
            )}
            <button
              onClick={handleAssignWeights}
              className={`w-full mt-2 button-primary ${
                !canAssignWeights || prize.criteriaNames.length <= 1 ? "opacity-50 cursor-not-allowed" : ""
              }`}
              disabled={!canAssignWeights || prize.criteriaNames.length <= 1}
            >
              Assign Weights
            </button>
          </ManagementCard>

          {/* Manage Evaluators */}
          <ManagementCard title="Manage Evaluators">
            <h3 className="font-semibold mb-2 text-white">Current Evaluators:</h3>
            <ul className="list-disc list-inside mb-4 text-white">
              {currentEvaluators.map((evaluator, index) => (
                <li key={index} className="truncate">
                  {evaluator}
                </li>
              ))}
            </ul>
            <textarea
              value={evaluators}
              onChange={(e) => setEvaluators(e.target.value)}
              placeholder="Enter evaluator addresses, separated by commas"
              className="w-full p-3 text-gray-900 bg-white rounded-md shadow-sm focus:ring-2 focus:ring-primary-500 resize-none"
              rows={4}
            />
            <button
              onClick={handleAddEvaluators}
              className="w-full mt-2 button-primary"
            >
              Add Evaluators
            </button>
          </ManagementCard>

          {/* Allocate Rewards */}
          <ManagementCard title="Allocate Rewards">
            <div>
              <label className="block mb-2 text-white">Batch Size:</label>
              <input
                type="number"
                min="1"
                max={Number(prize.contributionCount - (prize.lastProcessedIndex || 0n))}
                value={batchSize}
                onChange={(e) => setBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full p-3 text-gray-900 bg-white rounded-md shadow-sm focus:ring-2 focus:ring-primary-500"
                disabled={!canAllocateRewards}
              />
            </div>
            <button
              onClick={handleAllocateRewards}
              className={`w-full button-primary mt-4 ${
                !canAllocateRewards || allocationInProgress ? "opacity-50 cursor-not-allowed" : ""
              }`}
              disabled={!canAllocateRewards || allocationInProgress}
            >
              {allocationInProgress ? "Allocating..." : "Allocate Rewards"}
            </button>
            <div className="mt-4 text-white">
              <p>
                Allocated {allocationDetails?.lastProcessedIndex.toString() || "0"} out of{" "}
                {allocationDetails?.contributionCount.toString() || "0"} contributions.
              </p>
              {!allocationDetails?.rewardsAllocated &&
                (allocationDetails?.lastProcessedIndex || 0n) < (allocationDetails?.contributionCount || 0n) && (
                  <p className="text-accent-300">Allocation in progress...</p>
                )}
              {allocationDetails?.rewardsAllocated && <p className="text-accent-300">All rewards have been allocated.</p>}
            </div>
          </ManagementCard>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ManagePrizePage);
